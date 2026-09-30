use std::{
    future::IntoFuture,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

use anyhow::Result;
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
};
use tokio::sync::watch;

use crate::update_progress::SessionStore;

#[derive(Clone)]
struct StatusState {
    session: Arc<SessionStore>,
    host: String,
    acknowledged: Arc<AtomicBool>,
}

pub(crate) struct StatusServer {
    shutdown: watch::Sender<bool>,
    thread: Option<thread::JoinHandle<()>>,
    acknowledged: Arc<AtomicBool>,
}

impl StatusServer {
    pub(crate) fn start(session: Arc<SessionStore>) -> Result<Self> {
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        let (shutdown, mut shutdown_rx) = watch::channel(false);
        let acknowledged = Arc::new(AtomicBool::new(false));
        let ack = acknowledged.clone();
        let thread = thread::Builder::new().name("update-status".into()).spawn(move || {
            let result: Result<()> = (|| {
                let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
                let announce = ready_tx.clone();
                runtime.block_on(async move {
                    let listener = crate::server::listener::bind_local_listener(0, false).await?;
                    let host = format!("127.0.0.1:{}", listener.local_addr()?.port());
                    session.change(|data| data.helper_url = Some(format!("http://{host}/status")))?;
                    let watchdog = session.clone();
                    let app = Router::new().route("/status", get(status).options(preflight)).with_state(StatusState {
                        session, host, acknowledged: ack,
                    });
                    let mut graceful_rx = shutdown_rx.clone();
                    let serving = axum::serve(crate::server::listener::protect_listener(listener), app)
                        .with_graceful_shutdown(async move { let _ = graceful_rx.changed().await; }).into_future();
                    tokio::pin!(serving);
                    let _ = announce.send(Ok(()));
                    tokio::select! {
                        result = &mut serving => result?,
                        _ = shutdown_rx.changed() => { let _ = tokio::time::timeout(Duration::from_secs(3), &mut serving).await; }
                        _ = tokio::time::sleep(Duration::from_secs(2400)) => {
                            let _ = watchdog.change(|session| {
                                session.phase = "failed".into();
                                session.installer_outcome = Some("unconfirmed".into());
                                session.diagnostic = Some("Update helper reached its forty-minute lifetime limit. Windows Installer may still be running; do not start another installation until it has finished. Inspect msi-install.log.".into());
                            });
                            #[cfg(all(windows, not(test)))]
                            std::process::exit(2);
                        }
                    }
                    Ok(())
                })
            })();
            if let Err(error) = result { let _ = ready_tx.send(Err(error.to_string())); }
        })?;
        match ready_rx.recv_timeout(Duration::from_secs(10))? {
            Ok(()) => Ok(Self {
                shutdown,
                thread: Some(thread),
                acknowledged,
            }),
            Err(error) => {
                let _ = shutdown.send(true);
                let _ = thread.join();
                anyhow::bail!(error)
            }
        }
    }

    pub(crate) fn await_acknowledgment(&self, timeout: Duration) {
        let deadline = std::time::Instant::now() + timeout;
        while !self.acknowledged.load(Ordering::Acquire) && std::time::Instant::now() < deadline {
            thread::sleep(Duration::from_millis(100));
        }
    }
}

impl Drop for StatusServer {
    fn drop(&mut self) {
        let _ = self.shutdown.send(true);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn allowed(state: &StatusState, headers: &HeaderMap) -> bool {
    headers.get("host").and_then(|value| value.to_str().ok()) == Some(state.host.as_str())
        && headers.get("origin").and_then(|value| value.to_str().ok())
            == Some(state.session.snapshot().origin.as_str())
}

fn cors(state: &StatusState, mut response: Response) -> Response {
    let headers = response.headers_mut();
    if let Ok(origin) = HeaderValue::from_str(&state.session.snapshot().origin) {
        headers.insert("access-control-allow-origin", origin);
    }
    headers.insert("vary", HeaderValue::from_static("Origin"));
    headers.insert("cache-control", HeaderValue::from_static("no-store"));
    headers.insert(
        "access-control-allow-private-network",
        HeaderValue::from_static("true"),
    );
    response
}

async fn preflight(State(state): State<StatusState>, headers: HeaderMap) -> Response {
    if !allowed(&state, &headers)
        || headers
            .get("access-control-request-method")
            .and_then(|value| value.to_str().ok())
            != Some("GET")
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut response = cors(&state, StatusCode::NO_CONTENT.into_response());
    response.headers_mut().insert(
        "access-control-allow-methods",
        HeaderValue::from_static("GET"),
    );
    response.headers_mut().insert(
        "access-control-allow-headers",
        HeaderValue::from_static("X-HolyCluster-Update"),
    );
    response
}

async fn status(State(state): State<StatusState>, headers: HeaderMap) -> Response {
    let session = state.session.snapshot();
    if !allowed(&state, &headers)
        || headers
            .get("x-holycluster-update")
            .and_then(|value| value.to_str().ok())
            != Some(session.capability.as_str())
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    if session.terminal() {
        state.acknowledged.store(true, Ordering::Release);
    }
    cors(&state, Json(session).into_response())
}

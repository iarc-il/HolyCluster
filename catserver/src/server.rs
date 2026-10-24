mod availability_trace;
mod http_proxy;
pub(crate) mod listener;
mod radio;
mod radio_actions;
mod radio_configuration;
mod radio_control;
mod release_download;
mod rotator;
mod rotator_configuration;
mod session;
mod state;
mod update;

#[cfg(test)]
mod radio_actions_tests;
#[cfg(test)]
mod rotator_tests;
#[cfg(test)]
mod tests;

use anyhow::Result;
use axum::{
    Router,
    http::Uri,
    routing::{any, get, post},
};
use tokio::{
    net::TcpListener,
    sync::broadcast::{Receiver, Sender},
};

use crate::{radio_manager::RadioManager, rotator_manager::RotatorManager, tray_icon::UserEvent};

use self::{
    http_proxy::proxy,
    listener::{bind_startup_listener, bind_update_listener, protect_listener},
    session::ws_handler,
    state::AppState,
};

#[derive(Clone)]
pub struct ServerConfig {
    pub dns: String,
    pub is_using_ssl: bool,
    pub local_port: u16,
}

impl ServerConfig {
    pub fn build_uri(&self, schema: &str, path_and_query: &str) -> Uri {
        Uri::builder()
            .scheme(format!("{schema}{}", if self.is_using_ssl { "s" } else { "" }).as_str())
            .authority(self.dns.as_str())
            .path_and_query(path_and_query)
            .build()
            .expect("valid URI from config")
    }
}

pub struct Server {
    app: Router,
    listener: TcpListener,
    sender: Sender<UserEvent>,
}

impl Server {
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn build_server(
        sender: Sender<UserEvent>,
        radio: RadioManager,
        rotator: RotatorManager,
        mut server_config: ServerConfig,
        restart: Option<crate::updater::RestartContext>,
    ) -> Result<Self> {
        let listener = if let Some(context) = &restart {
            let marker = context.state_path.with_file_name("restart-startup.json");
            if !context.state_path.as_os_str().is_empty() {
                crate::update_restart::startup_signal(context, &marker, None)?;
            }
            match bind_update_listener(context.port, std::time::Duration::from_secs(180)).await {
                Ok(listener) => {
                    if !context.state_path.as_os_str().is_empty() {
                        crate::updater::write_json(
                            &marker,
                            &serde_json::json!({ "id": context.id, "phase": "reconnecting" }),
                        )?;
                    }
                    listener
                }
                Err(error) => {
                    if !context.state_path.as_os_str().is_empty() {
                        crate::update_restart::startup_signal(
                            context,
                            &marker,
                            Some(error.to_string()),
                        )?;
                    }
                    return Err(error);
                }
            }
        } else {
            bind_startup_listener(server_config.local_port, std::time::Duration::from_secs(10))
                .await?
        };
        server_config.local_port = listener.local_addr()?.port();
        let mut state = AppState::new(server_config, radio, rotator, sender.clone())?;
        #[cfg(target_os = "linux")]
        if let Some(context) = &restart
            && !context.state_path.as_os_str().is_empty()
        {
            crate::updater::linux_restart::complete(context)?;
        }
        state.updater = state.updater.with_restart(restart);
        let app = Router::new()
            .route("/ws", any(ws_handler))
            .route("/exit", post(exit_server_handler))
            .route("/open", post(open_tab_handler))
            .route("/api/ready", get(update::ready))
            .route("/api/update", get(update::status))
            .route("/api/update/check", post(update::check))
            .route("/api/update/install", post(update::install))
            .route(
                "/api/update/defer",
                post(|axum::extract::State(state)| {
                    update::run_operation(state, "defer", |updater| updater.defer())
                }),
            )
            .route(
                "/api/update/retry",
                post(|axum::extract::State(state)| {
                    update::run_operation(state, "retry", |updater| updater.retry())
                }),
            );
        let app = app.fallback(any(proxy)).with_state(state.clone());
        Ok(Self {
            app,
            listener,
            sender,
        })
    }

    pub fn local_port(&self) -> Result<u16> {
        Ok(self.listener.local_addr()?.port())
    }

    pub async fn run_server(self) -> Result<UserEvent> {
        let receiver = self.sender.subscribe();
        let (reason_sender, reason_receiver) = tokio::sync::oneshot::channel();
        axum::serve(protect_listener(self.listener), self.app)
            .with_graceful_shutdown(async move {
                let reason = shutdown(receiver).await;
                let _ = reason_sender.send(reason);
            })
            .await?;
        Ok(reason_receiver.await.unwrap_or(UserEvent::Quit))
    }
}

async fn exit_server_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::http::StatusCode {
    let _ = state.sender.send(UserEvent::Quit);
    axum::http::StatusCode::OK
}

async fn open_tab_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::http::StatusCode {
    let _ = state
        .sender
        .send(UserEvent::OpenBrowser("existing_instance_http"));
    axum::http::StatusCode::OK
}

async fn shutdown(mut receiver: Receiver<UserEvent>) -> UserEvent {
    while let Ok(message) = receiver.recv().await {
        if message.is_shutdown() {
            return message;
        }
    }
    UserEvent::Quit
}

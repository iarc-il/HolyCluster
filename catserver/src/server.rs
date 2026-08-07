mod http_proxy;
mod radio;
mod radio_actions;
mod radio_configuration;
mod radio_control;
mod rotator;
mod session;
mod state;
mod update;

#[cfg(test)]
mod radio_actions_tests;
#[cfg(test)]
mod tests;

use std::{
    net::{Ipv4Addr, SocketAddrV4},
    path::PathBuf,
};

use anyhow::{Context, Result};
use axum::{
    Router,
    http::Uri,
    routing::{any, get, post},
};
use tokio::{
    net::TcpListener,
    sync::broadcast::{Receiver, Sender},
};

use crate::{radio_manager::RadioManager, rotator::AnyRotator, tray_icon::UserEvent};

use self::{
    http_proxy::{local_ui, proxy},
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
    pub async fn build_server(
        sender: Sender<UserEvent>,
        radio: RadioManager,
        rotator: AnyRotator,
        server_config: ServerConfig,
        use_local_ui: bool,
    ) -> Result<Self> {
        let ui_dir = use_local_ui.then(find_ui_dir).transpose()?;
        let state = AppState::new(server_config, radio, rotator, sender.clone(), ui_dir)?;
        let app = Router::new()
            .route("/ws", any(ws_handler))
            .route("/exit", post(exit_server_handler))
            .route("/open", post(open_tab_handler))
            .route("/api/update", get(update::status))
            .route(
                "/api/update/check",
                post(|axum::extract::State(state)| update::run(state, |updater| updater.check())),
            )
            .route("/api/update/install", post(update::install))
            .route(
                "/api/update/defer",
                post(|axum::extract::State(state)| update::run(state, |updater| updater.defer())),
            )
            .route(
                "/api/update/retry",
                post(|axum::extract::State(state)| update::run(state, |updater| updater.retry())),
            );
        let app = if use_local_ui {
            app.fallback(any(local_ui))
        } else {
            app.fallback(any(proxy))
        }
        .with_state(state.clone());
        let listener = TcpListener::bind(SocketAddrV4::new(
            Ipv4Addr::LOCALHOST,
            state.server_config.local_port,
        ))
        .await?;
        Ok(Self {
            app,
            listener,
            sender,
        })
    }

    pub async fn run_server(self) -> Result<()> {
        axum::serve(self.listener, self.app)
            .with_graceful_shutdown(shutdown(self.sender.subscribe()))
            .await?;
        Ok(())
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
    let _ = state.sender.send(UserEvent::OpenBrowser);
    axum::http::StatusCode::OK
}

fn find_ui_dir() -> Result<PathBuf> {
    let mut path = std::env::var("APPIMAGE")
        .map(PathBuf::from)
        .or_else(|_| std::env::current_exe())?;

    loop {
        let ui_dir = path.join("ui/dist");
        if ui_dir.exists() {
            return Ok(ui_dir);
        }
        path = path
            .parent()
            .with_context(|| format!("Cannot get parent of {}", path.display()))?
            .into();
    }
}

async fn shutdown(mut receiver: Receiver<UserEvent>) {
    while let Ok(message) = receiver.recv().await
        && message != UserEvent::Quit
    {}
}

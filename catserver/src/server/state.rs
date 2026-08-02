use std::path::PathBuf;

use axum::body::Body;
use hyper_tls::HttpsConnector;
use hyper_util::{
    client::legacy::{Client, connect::HttpConnector},
    rt::TokioExecutor,
};
use tokio::sync::broadcast::Sender;

use crate::{radio_manager::RadioManager, rotator::AnyRotator, tray_icon::UserEvent};

use super::{
    ServerConfig,
    radio_configuration::{RadioConfiguration, production},
};

#[derive(Clone)]
pub(super) struct AppState {
    pub(super) server_config: ServerConfig,
    pub(super) radio: RadioManager,
    pub(super) rotator: AnyRotator,
    pub(super) http_client: Client<HttpsConnector<HttpConnector>, Body>,
    pub(super) sender: Sender<UserEvent>,
    pub(super) ui_dir: Option<PathBuf>,
    pub(super) radio_configuration: RadioConfiguration,
}

impl AppState {
    pub(super) fn new(
        server_config: ServerConfig,
        radio: RadioManager,
        rotator: AnyRotator,
        sender: Sender<UserEvent>,
        ui_dir: Option<PathBuf>,
    ) -> Self {
        Self {
            server_config,
            radio_configuration: production(radio.clone()),
            radio,
            rotator,
            http_client: Client::builder(TokioExecutor::new()).build(HttpsConnector::new()),
            sender,
            ui_dir,
        }
    }
}

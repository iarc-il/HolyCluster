mod local_ui;
mod proxy;
mod update;

use std::{
    fs,
    net::{Ipv4Addr, SocketAddr, SocketAddrV4},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use super::{Server, ServerConfig};
use crate::{
    instance_port, radio_config::RadioConfig, radio_manager::RadioManager,
    rotator_config::RotatorConfig, rotator_manager::RotatorManager, tray_icon::UserEvent,
};
use axum::{Router, routing::post};

struct TestServer {
    address: SocketAddr,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

struct TestDir(PathBuf);

impl TestDir {
    fn new() -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("catserver-{unique}"));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[tokio::test]
async fn update_relaunch_uses_free_loopback_port_when_original_is_busy() {
    let previous = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = previous.local_addr().unwrap().port();
    let listener = super::bind_local_listener(port, true).await.unwrap();
    assert_ne!(listener.local_addr().unwrap().port(), port);
    assert_eq!(listener.local_addr().unwrap().ip(), Ipv4Addr::LOCALHOST);
}

#[tokio::test]
async fn fallback_port_is_discoverable_by_second_instance() {
    let previous = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let listener = super::bind_local_listener(previous.local_addr().unwrap().port(), true)
        .await
        .unwrap();
    let dir = TestDir::new();
    let file = dir.path().join("instance-port");
    instance_port::publish(&file, listener.local_addr().unwrap().port()).unwrap();
    assert_eq!(
        instance_port::read(&file).unwrap(),
        listener.local_addr().unwrap().port()
    );
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route("/open", post(|| async { "ok" })),
        )
        .await
        .unwrap();
    });
    let port_file = file.clone();
    tokio::task::spawn_blocking(move || {
        crate::application::contact_existing_instance(&port_file, "open")
    })
    .await
    .unwrap()
    .unwrap();
    server.abort();
    instance_port::clear(&file).unwrap();
    assert!(instance_port::read(&file).is_err());
}

#[tokio::test]
async fn normal_startup_rejects_occupied_port() {
    let previous = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = previous.local_addr().unwrap().port();
    assert!(super::bind_local_listener(port, false).await.is_err());
}

async fn spawn_app(app: Router) -> TestServer {
    let listener = tokio::net::TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    TestServer { address, task }
}

async fn spawn_catserver(upstream: SocketAddr) -> TestServer {
    let (sender, _) = tokio::sync::broadcast::channel::<UserEvent>(10);
    let config = RadioConfig::platform_default();
    let server = Server::build_server(
        sender,
        RadioManager::new(config.clone(), config.effective_backend(false)).unwrap(),
        RotatorManager::new(RotatorConfig::unconfigured()).unwrap(),
        ServerConfig {
            dns: upstream.to_string(),
            is_using_ssl: false,
            local_port: 0,
        },
        false,
        false,
    )
    .await
    .unwrap();
    let address = server.listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        server.run_server().await.unwrap();
    });
    TestServer { address, task }
}

mod local_ui;
mod proxy;
mod readiness;
mod shutdown;
mod update;

use std::{
    fs,
    net::{Ipv4Addr, SocketAddr, SocketAddrV4},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use super::{Server, ServerConfig};
use crate::{
    radio_config::RadioConfig, radio_manager::RadioManager, rotator_config::RotatorConfig,
    rotator_manager::RotatorManager, tray_icon::UserEvent,
};
use axum::Router;

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
async fn normal_startup_waits_for_the_requested_port() {
    let previous = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = previous.local_addr().unwrap().port();
    let release = tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        drop(previous);
    });
    let listener = super::bind_startup_listener(port, std::time::Duration::from_secs(2))
        .await
        .unwrap();
    assert_eq!(listener.local_addr().unwrap().port(), port);
    release.await.unwrap();
}

#[tokio::test]
async fn normal_startup_never_migrates_from_an_occupied_port() {
    let previous = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = previous.local_addr().unwrap().port();
    let result = super::bind_startup_listener(port, std::time::Duration::from_millis(50)).await;
    assert!(result.is_err(), "normal startup migrated to another port");
}

#[tokio::test]
async fn update_restart_waits_for_the_original_port() {
    let previous = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = previous.local_addr().unwrap().port();
    let release = tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        drop(previous);
    });
    let listener = super::bind_update_listener(port, std::time::Duration::from_secs(2))
        .await
        .unwrap();
    assert_eq!(listener.local_addr().unwrap().port(), port);
    release.await.unwrap();
    let occupied = super::bind_update_listener(port, std::time::Duration::from_millis(50)).await;
    assert!(occupied.is_err(), "update restart migrated to another port");
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
    spawn_catserver_with_events(upstream).await.0
}

async fn spawn_catserver_with_events(
    upstream: SocketAddr,
) -> (TestServer, tokio::sync::broadcast::Sender<UserEvent>) {
    spawn_catserver_with_restart(upstream, None).await
}

async fn spawn_catserver_with_restart(
    upstream: SocketAddr,
    restart: Option<crate::updater::RestartContext>,
) -> (TestServer, tokio::sync::broadcast::Sender<UserEvent>) {
    let (sender, _) = tokio::sync::broadcast::channel::<UserEvent>(10);
    let config = RadioConfig::platform_default();
    let server = Server::build_server(
        sender.clone(),
        RadioManager::new(config.clone(), config.effective_backend(false)).unwrap(),
        RotatorManager::new(RotatorConfig::unconfigured()).unwrap(),
        ServerConfig {
            dns: upstream.to_string(),
            is_using_ssl: false,
            local_port: 0,
        },
        false,
        restart,
    )
    .await
    .unwrap();
    let address = server.listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        server.run_server().await.unwrap();
    });
    (TestServer { address, task }, sender)
}

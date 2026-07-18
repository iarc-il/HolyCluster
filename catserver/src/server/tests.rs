use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};

use axum::{
    Router,
    body::Body,
    extract::Request,
    http::{HeaderValue, StatusCode},
    response::Response,
    routing::any,
};
use tokio::{net::TcpListener, sync::broadcast, task::JoinHandle};

use super::{Server, ServerConfig};
use crate::{
    dummy::DummyRadio, dummy_rotator::DummyRotator, rig::AnyRadio, rotator::AnyRotator,
    tray_icon::UserEvent,
};

struct TestServer {
    address: SocketAddr,
    task: JoinHandle<()>,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn spawn_app(app: Router) -> TestServer {
    let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    TestServer { address, task }
}

async fn spawn_catserver(upstream: SocketAddr) -> TestServer {
    let (sender, _) = broadcast::channel::<UserEvent>(10);
    let server = Server::build_server(
        sender,
        AnyRadio::new(DummyRadio::new()),
        AnyRotator::new(DummyRotator::new()),
        ServerConfig {
            dns: upstream.to_string(),
            is_using_ssl: false,
            local_port: 0,
        },
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

#[tokio::test]
async fn proxies_arbitrary_paths_and_queries() {
    let upstream = spawn_app(Router::new().fallback(any(|request: Request| async move {
        let path_and_query = request
            .uri()
            .path_and_query()
            .map(|value| value.as_str())
            .unwrap_or_default()
            .to_owned();
        let mut response = Response::new(Body::from(path_and_query));
        *response.status_mut() = StatusCode::CREATED;
        response
            .headers_mut()
            .insert("x-upstream", HeaderValue::from_static("true"));
        response
    })))
    .await;
    let catserver = spawn_catserver(upstream.address).await;

    let response = reqwest::get(format!(
        "http://{}/future/endpoint?first=1&second=two",
        catserver.address
    ))
    .await
    .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(response.headers()["x-upstream"], "true");
    assert_eq!(
        response.text().await.unwrap(),
        "/future/endpoint?first=1&second=two"
    );
}

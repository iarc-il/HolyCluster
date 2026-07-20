use std::{
    fs,
    net::{Ipv4Addr, SocketAddr, SocketAddrV4},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Request, WebSocketUpgrade, ws::Message},
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header},
    response::Response,
    routing::{any, get},
};
use futures_util::{SinkExt, StreamExt};
use hyper_tls::HttpsConnector;
use hyper_util::{client::legacy::Client, rt::TokioExecutor};
use tokio::{net::TcpListener, sync::broadcast, task::JoinHandle};
use tokio_tungstenite::{connect_async, tungstenite::client::IntoClientRequest};

use super::{AppState, Server, ServerConfig, local_ui};
use crate::{
    dummy::DummyRadio, dummy_rotator::DummyRotator, rig::AnyRadio, rotator::AnyRotator,
    tray_icon::UserEvent,
};

struct TestServer {
    address: SocketAddr,
    task: JoinHandle<()>,
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

#[tokio::test]
async fn preserves_request_method_headers_and_body() {
    let upstream = spawn_app(Router::new().fallback(any(|request: Request| async move {
        let method = request.method().clone();
        let test_header = request
            .headers()
            .get("x-test-request")
            .cloned()
            .unwrap_or_else(|| HeaderValue::from_static("missing"));
        let host = request.headers().get("host").cloned().unwrap();
        let hop_header = if request.headers().contains_key("x-request-hop") {
            "present"
        } else {
            "removed"
        };
        let body = to_bytes(request.into_body(), usize::MAX).await.unwrap();
        let mut response = Response::new(Body::from(body));
        response
            .headers_mut()
            .insert("x-received-method", method.as_str().parse().unwrap());
        response
            .headers_mut()
            .insert("x-received-request-header", test_header);
        response.headers_mut().insert("x-received-host", host);
        response
            .headers_mut()
            .insert("x-request-hop-status", HeaderValue::from_static(hop_header));
        response
            .headers_mut()
            .insert("connection", HeaderValue::from_static("x-response-hop"));
        response
            .headers_mut()
            .insert("x-response-hop", HeaderValue::from_static("removed"));
        response
    })))
    .await;
    let catserver = spawn_catserver(upstream.address).await;

    let response = reqwest::Client::new()
        .request(
            Method::PATCH,
            format!("http://{}/future/endpoint", catserver.address),
        )
        .header("x-test-request", "preserved")
        .header("connection", "x-request-hop")
        .header("x-request-hop", "removed")
        .body("request body")
        .send()
        .await
        .unwrap();

    assert_eq!(response.headers()["x-received-method"], "PATCH");
    assert_eq!(response.headers()["x-received-request-header"], "preserved");
    assert_eq!(
        response.headers()["x-received-host"],
        upstream.address.to_string()
    );
    assert_eq!(response.headers()["x-request-hop-status"], "removed");
    assert!(!response.headers().contains_key("x-response-hop"));
    assert_eq!(response.text().await.unwrap(), "request body");
}

#[tokio::test]
async fn returns_bad_gateway_when_upstream_is_unavailable() {
    let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let upstream = listener.local_addr().unwrap();
    drop(listener);
    let catserver = spawn_catserver(upstream).await;

    let response = reqwest::get(format!("http://{}/unavailable", catserver.address))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
}

#[tokio::test]
async fn tunnels_arbitrary_websocket_upgrades() {
    let upstream = spawn_app(Router::new().fallback(any(
        |websocket: WebSocketUpgrade, uri: Uri, headers: HeaderMap| async move {
            websocket
                .protocols(["test-protocol"])
                .on_upgrade(move |mut socket| async move {
                    let handshake = format!(
                        "{} {}",
                        uri.path_and_query().unwrap(),
                        headers["x-test-request"].to_str().unwrap()
                    );
                    socket.send(Message::Text(handshake.into())).await.unwrap();
                    while let Some(Ok(message)) = socket.recv().await {
                        socket.send(message).await.unwrap();
                    }
                })
        },
    )))
    .await;
    let catserver = spawn_catserver(upstream.address).await;
    for path in [
        "/future_socket?token=abc",
        "/submit_spot?token=abc",
        "/spots_ws?token=abc",
    ] {
        let mut request = format!("ws://{}{path}", catserver.address)
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert("x-test-request", HeaderValue::from_static("preserved"));
        request.headers_mut().insert(
            header::SEC_WEBSOCKET_PROTOCOL,
            HeaderValue::from_static("test-protocol"),
        );

        let (mut socket, response) = connect_async(request).await.unwrap();

        assert_eq!(
            response.headers()[header::SEC_WEBSOCKET_PROTOCOL],
            "test-protocol"
        );
        assert_eq!(
            socket.next().await.unwrap().unwrap().into_text().unwrap(),
            format!("{path} preserved")
        );
        socket
            .send(tokio_tungstenite::tungstenite::Message::Binary(
                vec![1, 2, 3].into(),
            ))
            .await
            .unwrap();
        assert_eq!(
            socket.next().await.unwrap().unwrap().into_data(),
            vec![1, 2, 3]
        );
        socket.close(None).await.unwrap();
    }
}

#[tokio::test]
async fn local_ui_only_serves_get_and_head_requests() {
    let upstream = spawn_app(
        Router::new().route(
            "/asset.txt",
            get(|websocket: WebSocketUpgrade| async move {
                websocket.on_upgrade(|mut socket| async move {
                    if let Some(Ok(message)) = socket.recv().await {
                        socket.send(message).await.unwrap();
                    }
                })
            })
            .patch(|request: Request| async move {
                let method = request.method().clone();
                let body = to_bytes(request.into_body(), usize::MAX).await.unwrap();
                let mut response = Response::new(Body::from(body));
                response
                    .headers_mut()
                    .insert("x-received-method", method.as_str().parse().unwrap());
                response
            }),
        ),
    )
    .await;
    let ui_dir = TestDir::new();
    fs::write(ui_dir.path().join("asset.txt"), "local asset").unwrap();
    let (sender, _) = broadcast::channel::<UserEvent>(10);
    let state = AppState {
        server_config: ServerConfig {
            dns: upstream.address.to_string(),
            is_using_ssl: false,
            local_port: 0,
        },
        radio: AnyRadio::new(DummyRadio::new()),
        rotator: AnyRotator::new(DummyRotator::new()),
        http_client: Client::builder(TokioExecutor::new()).build(HttpsConnector::new()),
        sender,
        ui_dir: Some(ui_dir.path().to_owned()),
    };
    let catserver = spawn_app(Router::new().fallback(any(local_ui)).with_state(state)).await;

    let local_response = reqwest::get(format!("http://{}/asset.txt", catserver.address))
        .await
        .unwrap();
    assert_eq!(local_response.text().await.unwrap(), "local asset");

    let proxy_response = reqwest::Client::new()
        .patch(format!("http://{}/asset.txt", catserver.address))
        .body("request body")
        .send()
        .await
        .unwrap();
    assert_eq!(proxy_response.headers()["x-received-method"], "PATCH");
    assert_eq!(proxy_response.text().await.unwrap(), "request body");

    let (mut socket, _) = connect_async(format!("ws://{}/asset.txt", catserver.address))
        .await
        .unwrap();
    socket
        .send(tokio_tungstenite::tungstenite::Message::Binary(
            vec![4, 5, 6].into(),
        ))
        .await
        .unwrap();
    assert_eq!(
        socket.next().await.unwrap().unwrap().into_data(),
        vec![4, 5, 6]
    );
}

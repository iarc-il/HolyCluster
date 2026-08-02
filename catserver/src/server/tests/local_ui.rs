use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Request, WebSocketUpgrade},
    response::Response,
    routing::{any, get},
};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast;
use tokio_tungstenite::connect_async;

use super::super::{ServerConfig, http_proxy::local_ui, state::AppState};
use super::{TestDir, spawn_app};
use crate::{
    dummy_rotator::DummyRotator, radio_config::RadioConfig, radio_manager::RadioManager,
    rotator::AnyRotator, tray_icon::UserEvent,
};

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
    std::fs::write(ui_dir.path().join("asset.txt"), "local asset").unwrap();
    let (sender, _) = broadcast::channel::<UserEvent>(10);
    let config = RadioConfig::platform_default();
    let state = AppState::new(
        ServerConfig {
            dns: upstream.address.to_string(),
            is_using_ssl: false,
            local_port: 0,
        },
        RadioManager::new(config.clone(), config.effective_backend(false)).unwrap(),
        AnyRotator::new(DummyRotator::new()),
        sender,
        Some(ui_dir.path().to_owned()),
    );
    let catserver = spawn_app(Router::new().fallback(any(local_ui)).with_state(state)).await;
    assert_eq!(
        reqwest::get(format!("http://{}/asset.txt", catserver.address))
            .await
            .unwrap()
            .text()
            .await
            .unwrap(),
        "local asset"
    );
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

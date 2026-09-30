use std::time::Duration;

use axum::{Router, extract::WebSocketUpgrade, routing::get};
use futures_util::StreamExt;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message, protocol::frame::coding::CloseCode},
};

use super::{UserEvent, spawn_app, spawn_catserver_with_events};

#[tokio::test]
async fn shutdown_distinguishes_update_restart_from_user_quit() {
    assert_eq!(
        UserEvent::update_shutdown(),
        if cfg!(windows) {
            UserEvent::RestartForUpdate
        } else {
            UserEvent::Quit
        }
    );
    let upstream = spawn_app(Router::new().route(
        "/ws",
        get(|websocket: WebSocketUpgrade| async move {
            websocket.on_upgrade(|mut socket| async move {
                while let Some(Ok(message)) = socket.recv().await {
                    if matches!(message, axum::extract::ws::Message::Close(_)) {
                        break;
                    }
                }
            })
        }),
    ))
    .await;

    for intent in [UserEvent::Quit, UserEvent::RestartForUpdate] {
        let (mut catserver, sender) = spawn_catserver_with_events(upstream.address).await;
        let (mut socket, _) = connect_async(format!("ws://{}/ws", catserver.address))
            .await
            .unwrap();
        let init = tokio::time::timeout(Duration::from_secs(3), socket.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap()
            .into_text()
            .unwrap();
        let init: serde_json::Value = serde_json::from_str(&init).unwrap();
        assert_eq!(init["type"], "radio");
        assert!(init["catserver_version"].is_string());

        sender.send(UserEvent::OpenBrowser).unwrap();
        assert!(
            reqwest::get(format!("http://{}/api/update", catserver.address))
                .await
                .unwrap()
                .status()
                .is_success()
        );
        if intent == UserEvent::Quit {
            assert!(
                reqwest::Client::new()
                    .post(format!("http://{}/exit", catserver.address))
                    .send()
                    .await
                    .unwrap()
                    .status()
                    .is_success()
            );
        } else {
            sender.send(intent.clone()).unwrap();
        }

        let (messages, close_code) = tokio::time::timeout(Duration::from_secs(3), async {
            let mut messages = Vec::<serde_json::Value>::new();
            let close_code = loop {
                match socket.next().await.unwrap().unwrap() {
                    Message::Text(text) => messages.push(serde_json::from_str(&text).unwrap()),
                    Message::Close(frame) => break frame.unwrap().code,
                    _ => {}
                }
            };
            (messages, close_code)
        })
        .await
        .expect("shutdown did not close the WebSocket transport");
        assert!(messages.iter().any(|message| {
            message["type"] == "radio" && message["event"] == "focus" && message["focus"] == true
        }));
        let closes_page = messages.iter().any(|message| {
            message["type"] == "radio" && message["event"] == "close" && message["close"] == true
        });
        if intent == UserEvent::RestartForUpdate {
            assert!(!closes_page, "update restart closed the browser document");
            assert!(messages.iter().any(|message| {
                message["version"] == 1
                    && message["type"] == "update"
                    && message["event"] == "restarting"
            }));
            assert_eq!(close_code, CloseCode::Restart);
        } else {
            assert!(closes_page, "ordinary Quit did not close the browser page");
            assert_eq!(close_code, CloseCode::Normal);
        }
        tokio::time::timeout(Duration::from_secs(3), &mut catserver.task)
            .await
            .expect("shutdown did not stop the local HTTP server")
            .unwrap();
    }
}

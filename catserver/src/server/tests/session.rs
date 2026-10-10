use std::time::Duration;

use axum::{Router, extract::WebSocketUpgrade, routing::get};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message, protocol::frame::coding::CloseCode},
};

use super::{UserEvent, spawn_app, spawn_catserver_with_events};

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn event(socket: &mut Socket, name: &str) -> serde_json::Value {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if let Message::Text(text) = socket.next().await.unwrap().unwrap() {
                let message: serde_json::Value = serde_json::from_str(&text).unwrap();
                if message["event"] == name {
                    return message;
                }
            }
        }
    })
    .await
    .expect("missing local response")
}

async fn close(socket: &mut Socket) -> CloseCode {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if let Message::Close(frame) = socket.next().await.unwrap().unwrap() {
                return frame.unwrap().code;
            }
        }
    })
    .await
    .expect("session did not close")
}

async fn local_controls(socket: &mut Socket) {
    socket
        .send(Message::Text(
            r#"{"version":1,"type":"radio","action":"GetCapabilities"}"#.into(),
        ))
        .await
        .unwrap();
    assert_eq!(event(socket, "capabilities").await["type"], "radio");
    socket
        .send(Message::Text(
            r#"{"version":1,"type":"radio","action":"RetryRadio"}"#.into(),
        ))
        .await
        .unwrap();
    assert_eq!(event(socket, "configuration_result").await["ok"], true);
}

#[tokio::test]
async fn refused_upstream_keeps_local_controls_and_rejects_submit() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    drop(listener);
    let (mut server, sender) = spawn_catserver_with_events(address).await;
    let (mut socket, _) = connect_async(format!("ws://{}/ws", server.address))
        .await
        .unwrap();
    local_controls(&mut socket).await;
    socket
        .send(Message::Text(r#"{"version":1,"type":"submit"}"#.into()))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if let Message::Text(text) = socket.next().await.unwrap().unwrap() {
                let message: serde_json::Value = serde_json::from_str(&text).unwrap();
                if message["type"] == "submit" {
                    assert_eq!(message["status"], "failure");
                    assert_eq!(message["error_type"], "BackendUnavailable");
                    break;
                }
            }
        }
    })
    .await
    .unwrap();
    local_controls(&mut socket).await;
    socket
        .send(Message::Text(
            r#"{"version":1,"type":"spots","action":"initial"}"#.into(),
        ))
        .await
        .unwrap();
    local_controls(&mut socket).await;
    let listener = tokio::net::TcpListener::bind(address).await.unwrap();
    let (transport, _) = tokio::time::timeout(Duration::from_secs(4), listener.accept())
        .await
        .unwrap()
        .unwrap();
    let mut upstream = tokio_tungstenite::accept_async(transport).await.unwrap();
    let request = tokio::time::timeout(Duration::from_secs(3), upstream.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let request: serde_json::Value = serde_json::from_str(request.to_text().unwrap()).unwrap();
    assert_eq!(request["type"], "spots");
    assert_eq!(request["action"], "initial");
    assert!(
        tokio::time::timeout(Duration::from_millis(100), upstream.next())
            .await
            .is_err(),
        "offline submit was replayed"
    );
    sender.send(UserEvent::Quit).unwrap();
    assert_eq!(close(&mut socket).await, CloseCode::Normal);
    tokio::time::timeout(Duration::from_secs(3), &mut server.task)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn offline_history_request_explicitly_closes_instead_of_being_queued() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let (server, _) = spawn_catserver_with_events(listener.local_addr().unwrap()).await;
    let (mut socket, _) = connect_async(format!("ws://{}/ws", server.address))
        .await
        .unwrap();
    let (_pending, _) = listener.accept().await.unwrap();
    socket
        .send(Message::Text(
            r#"{"version":1,"type":"spots","action":"history","start":1,"end":2}"#.into(),
        ))
        .await
        .unwrap();
    assert_eq!(close(&mut socket).await, CloseCode::Restart);
}

#[tokio::test]
async fn pending_handshake_keeps_local_controls_and_shutdown_cancels_it() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let (mut server, sender) = spawn_catserver_with_events(listener.local_addr().unwrap()).await;
    let (mut socket, _) = connect_async(format!("ws://{}/ws", server.address))
        .await
        .unwrap();
    let (_pending, _) = tokio::time::timeout(Duration::from_secs(3), listener.accept())
        .await
        .unwrap()
        .unwrap();
    local_controls(&mut socket).await;
    sender.send(UserEvent::RestartForUpdate).unwrap();
    assert_eq!(event(&mut socket, "restarting").await["type"], "update");
    assert_eq!(close(&mut socket).await, CloseCode::Restart);
    tokio::time::timeout(Duration::from_secs(3), &mut server.task)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn subscription_survives_connect_race_and_abrupt_eof_closes_browser() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let (server, _) = spawn_catserver_with_events(listener.local_addr().unwrap()).await;
    let (mut socket, _) = connect_async(format!("ws://{}/ws", server.address))
        .await
        .unwrap();
    let (transport, _) = listener.accept().await.unwrap();
    socket
        .send(Message::Text(
            r#"{"version":1,"type":"spots","action":"initial"}"#.into(),
        ))
        .await
        .unwrap();
    local_controls(&mut socket).await;
    let mut upstream = tokio_tungstenite::accept_async(transport).await.unwrap();
    let request = tokio::time::timeout(Duration::from_secs(3), upstream.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let request: serde_json::Value = serde_json::from_str(request.to_text().unwrap()).unwrap();
    assert_eq!(request["action"], "initial");
    drop(upstream); // Transport EOF, not a WebSocket close frame.
    assert_eq!(close(&mut socket).await, CloseCode::Restart);

    // A fresh browser session can subscribe again after the explicit reconnect.
    let (mut socket, _) = connect_async(format!("ws://{}/ws", server.address))
        .await
        .unwrap();
    let (transport, _) = listener.accept().await.unwrap();
    let mut upstream = tokio_tungstenite::accept_async(transport).await.unwrap();
    socket
        .send(Message::Text(
            r#"{"version":1,"type":"spots","action":"catch_up","last_time":123}"#.into(),
        ))
        .await
        .unwrap();
    let request = tokio::time::timeout(Duration::from_secs(3), upstream.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(request.to_text().unwrap().contains("catch_up"));
}

#[tokio::test]
async fn timed_out_handshake_retries_and_restores_latest_subscription() {
    use tokio::io::AsyncReadExt;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let (server, _) = spawn_catserver_with_events(listener.local_addr().unwrap()).await;
    let (mut socket, _) = connect_async(format!("ws://{}/ws", server.address))
        .await
        .unwrap();
    let (mut pending, _) = listener.accept().await.unwrap();
    socket
        .send(Message::Text(
            r#"{"version":1,"type":"spots","action":"initial"}"#.into(),
        ))
        .await
        .unwrap();
    local_controls(&mut socket).await;
    socket
        .send(Message::Text(
            r#"{"version":1,"type":"spots","action":"catch_up","last_time":456}"#.into(),
        ))
        .await
        .unwrap();
    // The abandoned handshake must close its TCP transport, not hang forever.
    tokio::time::timeout(Duration::from_secs(12), async {
        let mut data = [0; 1024];
        while pending.read(&mut data).await.unwrap() != 0 {}
    })
    .await
    .expect("handshake did not time out");
    local_controls(&mut socket).await;
    let (transport, _) = tokio::time::timeout(Duration::from_secs(4), listener.accept())
        .await
        .unwrap()
        .unwrap();
    let mut upstream = tokio_tungstenite::accept_async(transport).await.unwrap();
    let request = tokio::time::timeout(Duration::from_secs(3), upstream.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let request: serde_json::Value = serde_json::from_str(request.to_text().unwrap()).unwrap();
    assert_eq!(request["action"], "catch_up");
    assert_eq!(request["last_time"], 456);
    assert!(
        tokio::time::timeout(Duration::from_millis(100), upstream.next())
            .await
            .is_err(),
        "replayed more than the latest subscription"
    );
    upstream
        .send(Message::Text(
            r#"{"version":1,"type":"spots","event":"initial","spots":[]}"#.into(),
        ))
        .await
        .unwrap();
    assert_eq!(event(&mut socket, "initial").await["type"], "spots");
}

#[tokio::test]
async fn graceful_upstream_close_preserves_close_code() {
    let upstream = spawn_app(Router::new().route(
        "/ws",
        get(|ws: WebSocketUpgrade| async move {
            ws.on_upgrade(|mut socket| async move {
                socket
                    .send(axum::extract::ws::Message::Close(Some(
                        axum::extract::ws::CloseFrame {
                            code: 1000,
                            reason: "finished".into(),
                        },
                    )))
                    .await
                    .unwrap();
            })
        }),
    ))
    .await;
    let (server, _) = spawn_catserver_with_events(upstream.address).await;
    let (mut socket, _) = connect_async(format!("ws://{}/ws", server.address))
        .await
        .unwrap();
    assert_eq!(close(&mut socket).await, CloseCode::Normal);
}

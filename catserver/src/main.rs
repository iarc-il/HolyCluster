use std::ops::ControlFlow;

use anyhow::{Context, Result};
use axum::{
    Router,
    body::{Body, Bytes},
    extract::{
        Request, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{Response, StatusCode},
    response::IntoResponse,
    routing::any,
};
use axum_macros::debug_handler;
use futures_util::{SinkExt, StreamExt};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tower_http::services::ServeDir;

const HOLY_CLUSTER_URL: &str = "https://holycluster.iarc.org";

#[tokio::main]
async fn main() -> Result<()> {
    let client = Client::new();

    let app = Router::new().route("/radio", any(ws_handler));

    let app = if std::env::var("LOCAL_UI").is_ok() {
        let mut ui_dir = std::env::current_exe()?;
        let ui_dir = loop {
            let result = ui_dir.join("ui/dist");
            if result.exists() {
                break result;
            } else {
                ui_dir = ui_dir
                    .parent()
                    .with_context(|| format!("Cannot get parent of {}", ui_dir.display()))?
                    .into();
            }
        };
        app.route("/spots", any(proxy))
            .fallback_service(ServeDir::new(ui_dir))
    } else {
        app.fallback(any(proxy))
    };
    let app = app.with_state(client);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    axum::serve(listener, app).await?;
    Ok(())
}

#[debug_handler]
async fn proxy(State(client): State<Client>, request: Request<Body>) -> Response<Body> {
    let uri_string = format!(
        "{}{}",
        HOLY_CLUSTER_URL,
        request
            .uri()
            .path_and_query()
            .map(|x| x.as_str())
            .unwrap_or("")
    );
    let reqwest_response = match client.get(uri_string).send().await {
        Ok(res) => res,
        Err(_) => {
            return (StatusCode::BAD_REQUEST, Body::empty()).into_response();
        }
    };

    let mut response_builder = Response::builder().status(reqwest_response.status());
    *response_builder.headers_mut().unwrap() = reqwest_response.headers().clone();
    response_builder
        .body(Body::from_stream(reqwest_response.bytes_stream()))
        .unwrap()
}

#[derive(Serialize, Deserialize)]
struct StatusMessage {
    status: String,
    status_str: String,
    freq: u64,
    current_rig: u8,
}

async fn ws_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(handle_socket)
}

async fn handle_socket(mut socket: WebSocket) {
    if socket
        .send(Message::Ping(Bytes::from_static(&[1, 2, 3])))
        .await
        .is_err()
    {
        return;
    }

    let (mut sender, mut receiver) = socket.split();

    let message = StatusMessage {
        status: "connected".to_string(),
        status_str: "Status".to_string(),
        freq: 14200000,
        current_rig: 1,
    };

    let mut send_task = tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        sender
            .send(Message::Text(
                serde_json::to_string(&message).unwrap().into(),
            ))
            .await
            .unwrap();

        // let _ = sender
        //     .send(Message::Close(Some(CloseFrame {
        //         code: axum::extract::ws::close_code::NORMAL,
        //         reason: Utf8Bytes::from_static("Goodbye"),
        //     })))
        //     .await;
    });

    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if process_message(msg).is_break() {
                break;
            }
        }
    });

    tokio::select! {
        _ = (&mut send_task) => {
            recv_task.abort();
        },
        _ = (&mut recv_task) => {
            send_task.abort();
        }
    }
}

fn process_message(msg: Message) -> ControlFlow<(), ()> {
    match msg {
        Message::Text(_text) => {}
        Message::Binary(_data) => {}
        Message::Close(_) => {
            return ControlFlow::Break(());
        }

        _ => {}
    }
    ControlFlow::Continue(())
}

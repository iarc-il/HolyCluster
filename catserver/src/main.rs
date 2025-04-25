use anyhow::{Context, Result};
use axum::{
    Router,
    body::Body,
    extract::{
        Request, State, WebSocketUpgrade,
        ws::{CloseFrame, Message, Utf8Bytes, WebSocket},
    },
    http::{Response, StatusCode},
    response::IntoResponse,
    routing::any,
};
use axum_macros::debug_handler;
use futures_util::{SinkExt, StreamExt};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio_tungstenite::connect_async;
use tower_http::services::ServeDir;

mod utils;

const HOLY_CLUSTER_DNS: &str = "holycluster.iarc.org";

#[tokio::main]
async fn main() -> Result<()> {
    let client = Client::new();

    let app = Router::new()
        .route("/radio", any(cat_control_handler))
        .route("/submit_spot", any(submit_spot_handler));

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
        "https://{}{}",
        HOLY_CLUSTER_DNS,
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

async fn submit_spot_handler(websocket: WebSocketUpgrade) -> impl IntoResponse {
    websocket
        .write_buffer_size(0)
        .read_buffer_size(0)
        .accept_unmasked_frames(true)
        .on_upgrade(handle_submit_spot_socket)
}

async fn handle_submit_spot_socket(client_socket: WebSocket) {
    let (mut client_sender, mut client_receiver) = client_socket.split();

    let (stream, _response) =
        connect_async(format!("wss://{}{}", HOLY_CLUSTER_DNS, "/submit_spot"))
            .await
            .unwrap();
    let (mut server_sender, mut server_receiver) = stream.split();

    let mut send_task = tokio::spawn(async move {
        while let Some(Ok(message)) = server_receiver.next().await {
            client_sender
                .send(utils::tungstenite_to_axum_message(message))
                .await
                .unwrap();
        }
        let _ = client_sender
            .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                code: axum::extract::ws::close_code::NORMAL,
                reason: axum::extract::ws::Utf8Bytes::from_static("Goodbye"),
            })))
            .await;
    });

    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(message)) = client_receiver.next().await {
            server_sender
                .send(utils::axum_to_tungstenite_message(message))
                .await
                .unwrap();
        }
        let _ = server_sender
            .send(tokio_tungstenite::tungstenite::Message::Close(Some(
                tokio_tungstenite::tungstenite::protocol::CloseFrame {
                    code:
                        tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Normal,
                    reason: tokio_tungstenite::tungstenite::Utf8Bytes::from_static("Goodbye"),
                },
            )))
            .await;
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

#[derive(Serialize, Deserialize)]
struct StatusMessage {
    status: String,
    status_str: String,
    freq: u64,
    current_rig: u8,
}

async fn cat_control_handler(websocket: WebSocketUpgrade) -> impl IntoResponse {
    websocket
        .write_buffer_size(0)
        .read_buffer_size(0)
        .accept_unmasked_frames(true)
        .on_upgrade(handle_cat_control_socket)
}

async fn handle_cat_control_socket(mut socket: WebSocket) {
    let message = StatusMessage {
        status: "connected".to_string(),
        status_str: "Status".to_string(),
        freq: 14200000,
        current_rig: 1,
    };

    tokio::spawn(async move {
        socket
            .send(Message::Text(
                serde_json::to_string(&message).unwrap().into(),
            ))
            .await
            .unwrap();
        while let Some(Ok(message)) = socket.next().await {
            match message {
                Message::Text(text) => {
                    println!("{text}");
                }
                Message::Binary(_data) => {}
                Message::Close(_) => {
                    break;
                }
                _ => {}
            }
        }
        let _ = socket
            .send(Message::Close(Some(CloseFrame {
                code: axum::extract::ws::close_code::NORMAL,
                reason: Utf8Bytes::from_static("Goodbye"),
            })))
            .await;
    })
    .await
    .unwrap();
}

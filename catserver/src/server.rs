use std::net::{Ipv4Addr, SocketAddrV4};

use anyhow::{Context, Result, bail};
use axum::{
    Router,
    body::Body,
    extract::{
        Request, State, WebSocketUpgrade,
        ws::{CloseFrame, Message, Utf8Bytes, WebSocket},
    },
    response::{IntoResponse, Response},
    routing::any,
};
use futures_util::{SinkExt, StreamExt};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use tokio::{
    net::TcpListener,
    sync::{broadcast::Receiver, mpsc},
    task::JoinHandle,
};
use tokio_tungstenite::connect_async;
use tower_http::services::ServeDir;

use crate::{
    freq::Freq,
    rig::{AnyRadio, Mode, Slot},
    tray_icon::IconTrayEvent,
    utils,
};

#[derive(Clone)]
pub struct ServerConfig {
    pub dns: String,
    pub is_using_ssl: bool,
    pub local_port: u16,
}

impl ServerConfig {
    fn build_uri(&self, schema: &str, path_and_query: &str) -> String {
        format!(
            "{}{}://{}{}",
            schema,
            if self.is_using_ssl { "s" } else { "" },
            self.dns,
            path_and_query,
        )
    }
}

#[derive(Clone)]
struct AppState {
    server_config: ServerConfig,
    radio: AnyRadio,
    http_client: Client,
}

pub struct Server {
    app: Router,
    listener: TcpListener,
}

impl Server {
    pub async fn build_server(
        radio: AnyRadio,
        server_config: ServerConfig,
        use_local_ui: bool,
    ) -> Result<Self> {
        let http_client = Client::new();

        let app = Router::new()
            .route("/radio", any(cat_control_handler))
            .route("/submit_spot", any(submit_spot_handler));

        let app = if use_local_ui {
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
        let local_port = server_config.local_port;
        let app = app.with_state(AppState {
            server_config,
            radio,
            http_client,
        });

        let address = SocketAddrV4::new(Ipv4Addr::new(0, 0, 0, 0), local_port);
        let listener = TcpListener::bind(address).await?;
        Ok(Self { app, listener })
    }

    pub async fn run_server(self, quit_receiver: Receiver<IconTrayEvent>) -> Result<()> {
        axum::serve(self.listener, self.app)
            .with_graceful_shutdown(shutdown(quit_receiver))
            .await?;
        Ok(())
    }
}

async fn shutdown(mut quit_receiver: Receiver<IconTrayEvent>) {
    while let Ok(message) = quit_receiver.recv().await {
        if message == IconTrayEvent::Quit {
            break;
        }
    }
}

async fn proxy(State(state): State<AppState>, request: Request<Body>) -> Response<Body> {
    let uri_string = state.server_config.build_uri(
        "http",
        request
            .uri()
            .path_and_query()
            .map(|x| x.as_str())
            .unwrap_or(""),
    );

    let reqwest_response = match state.http_client.get(uri_string).send().await {
        Ok(result) => result,
        Err(error) => {
            tracing::error!("Error: {error:?}");
            return (StatusCode::BAD_REQUEST, Body::empty()).into_response();
        }
    };

    let mut response_builder = Response::builder().status(reqwest_response.status());
    if let Some(headers) = response_builder.headers_mut() {
        *headers = reqwest_response.headers().clone();
    }
    response_builder
        .body(Body::from_stream(reqwest_response.bytes_stream()))
        .unwrap()
}

async fn submit_spot_handler(
    State(state): State<AppState>,
    websocket: WebSocketUpgrade,
) -> impl IntoResponse {
    websocket
        .write_buffer_size(0)
        .read_buffer_size(0)
        .accept_unmasked_frames(true)
        .on_upgrade(async |websocket: WebSocket| {
            handle_submit_spot_socket(state.server_config, websocket)
                .await
                .unwrap()
        })
}

async fn handle_submit_spot_socket(
    server_config: ServerConfig,
    client_socket: WebSocket,
) -> Result<()> {
    let (mut client_sender, mut client_receiver) = client_socket.split();
    let (stream, _response) = connect_async(server_config.build_uri("ws", "/submit_spot")).await?;
    let (mut server_sender, mut server_receiver) = stream.split();

    let mut send_task: JoinHandle<Result<()>> = tokio::spawn(async move {
        while let Some(Ok(message)) = server_receiver.next().await {
            client_sender
                .send(utils::tungstenite_to_axum_message(message))
                .await?;
        }

        // This is best effort, so we ignore errors
        let _ = client_sender
            .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                code: axum::extract::ws::close_code::NORMAL,
                reason: axum::extract::ws::Utf8Bytes::from_static("Goodbye"),
            })))
            .await;
        Ok(())
    });

    let mut recv_task: JoinHandle<Result<()>> = tokio::spawn(async move {
        while let Some(Ok(message)) = client_receiver.next().await {
            let result = server_sender
                .send(utils::axum_to_tungstenite_message(message))
                .await;
            if let Err(error) = &result {
                use tokio_tungstenite::tungstenite::Error;
                match error {
                    Error::ConnectionClosed => {
                        break;
                    }
                    _ => {
                        result?;
                    }
                }
            }
        }

        // This is best effort, so we ignore errors
        let _ = server_sender
            .send(tokio_tungstenite::tungstenite::Message::Close(Some(
                tokio_tungstenite::tungstenite::protocol::CloseFrame {
                    code:
                        tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Normal,
                    reason: tokio_tungstenite::tungstenite::Utf8Bytes::from_static("Goodbye"),
                },
            )))
            .await;
        Ok(())
    });

    tokio::select! {
        _ = (&mut send_task) => {
            recv_task.abort();
        },
        _ = (&mut recv_task) => {
            send_task.abort();
        }
    }
    Ok(())
}

async fn cat_control_handler(
    websocket: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    websocket
        .write_buffer_size(0)
        .read_buffer_size(0)
        .accept_unmasked_frames(true)
        .on_upgrade(async |websocket: WebSocket| {
            handle_cat_control_socket(websocket, state.radio)
                .await
                .unwrap()
        })
}

async fn handle_cat_control_socket(socket: WebSocket, radio: AnyRadio) -> Result<()> {
    let (mut sender_inner, mut receiver) = socket.split();

    let (sender, mut sender_recv) = mpsc::unbounded_channel::<Message>();

    let mut send_task: JoinHandle<Result<()>> = tokio::spawn(async move {
        while let Some(message) = sender_recv.recv().await {
            if sender_inner.send(message).await.is_err() {
                break;
            }
        }

        // This is best effort, so we ignore errors
        let _ = sender_inner
            .send(Message::Close(Some(CloseFrame {
                code: axum::extract::ws::close_code::NORMAL,
                reason: Utf8Bytes::from_static("Goodbye"),
            })))
            .await;
        Ok(())
    });

    let poll_radio = radio.clone();
    let poll_sender = sender.clone();
    let mut poll_task: JoinHandle<Result<()>> = tokio::spawn(async move {
        let message = InitMessage {
            status: "connected".into(),
            version: env!("VERSION").into(),
        };
        let radio = poll_radio.clone();
        let sender = poll_sender;

        sender.send(Message::Text(serde_json::to_string(&message)?.into()))?;

        loop {
            let data = radio.write().get_status();
            let message = Message::Text(serde_json::to_string(&data)?.into());
            sender.send(message)?;
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    });

    let command_radio = radio.clone();
    let command_sender = sender.clone();
    let mut command_task: JoinHandle<Result<()>> = tokio::spawn(async move {
        let radio = command_radio.clone();
        let sender = command_sender;

        while let Some(Ok(message)) = receiver.next().await {
            match message {
                Message::Text(text) => {
                    process_message(text.to_string(), radio.clone())?;
                    let status = radio.write().get_status();
                    let message = Message::Text(serde_json::to_string(&status)?.into());
                    sender.send(message)?;
                }
                Message::Binary(data) => {
                    tracing::warn!("Ignoring binary data: {data:?}");
                }
                Message::Close(_) => {
                    break;
                }
                message => {
                    tracing::warn!("Ignoring message: {message:?}");
                }
            }
        }
        Ok(())
    });

    tokio::select! {
        result = (&mut send_task) => {
            tracing::debug!("Closing websocket since send task exited");
            command_task.abort();
            poll_task.abort();
            result?
        },
        result = (&mut poll_task) => {
            tracing::debug!("Closing websocket since poll task exited");
            command_task.abort();
            send_task.abort();
            result?
        },
        result = (&mut command_task) => {
            tracing::debug!("Closing websocket since command task exited");
            poll_task.abort();
            send_task.abort();
            result?
        }
    }
}

#[derive(Serialize)]
struct InitMessage {
    status: String,
    version: String,
}

#[derive(Deserialize)]
struct SetModeAndFreq {
    mode: String,
    freq: f32,
    band: u8,
}

#[derive(Deserialize)]
struct SetRig {
    rig: u8,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ClientMessage {
    SetRig(SetRig),
    SetModeAndFreq(SetModeAndFreq),
}

fn process_message(message: String, radio: AnyRadio) -> Result<()> {
    let message: ClientMessage = serde_json::from_str(&message)?;
    match message {
        ClientMessage::SetRig(set_rig) => {
            tracing::debug!("Setting rig to {}", set_rig.rig);
            radio.write().set_rig(set_rig.rig);
        }
        ClientMessage::SetModeAndFreq(set_mode_and_freq) => {
            let is_upper = !matches!(set_mode_and_freq.band, 160 | 80 | 40);
            let mode = match (set_mode_and_freq.mode.as_str(), is_upper) {
                ("SSB", true) => Mode::USB,
                ("SSB", false) => Mode::LSB,
                ("DIGI" | "FT8" | "FT4", _) => Mode::Data,
                ("CW", _) => Mode::CW,
                (mode, is_upper) => {
                    bail!("Unknown mode: {mode}, is upper: {is_upper}");
                }
            };
            tracing::debug!("Setting mode to {mode:?}");
            let freq = Freq::from_f32_khz(set_mode_and_freq.freq);
            tracing::debug!("Setting freq to {freq:?}");
            radio.write().set_mode(mode);
            radio.write().set_frequency(Slot::A, freq);
        }
    }
    Ok(())
}

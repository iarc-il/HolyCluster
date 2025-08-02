use anyhow::anyhow;
use std::{
    net::{Ipv4Addr, SocketAddrV4},
    sync::{
        Arc,
        atomic::{AtomicU8, Ordering},
    },
    time::Duration,
};

use anyhow::{Context, Result, bail};
use axum::{
    Router,
    body::Body,
    extract::{
        Request, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::{IntoResponse, Response},
    routing::{any, post},
};
use futures_util::{SinkExt, StreamExt};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use tokio::{
    net::TcpListener,
    sync::{
        broadcast::{Receiver, Sender},
        mpsc,
    },
};
use tokio_tungstenite::connect_async;
use tower_http::services::ServeDir;

use crate::{
    freq::Freq,
    rig::{AnyRadio, Mode, Slot},
    tray_icon::UserEvent,
    utils,
};

#[derive(Clone)]
pub struct ServerConfig {
    pub dns: String,
    pub is_using_ssl: bool,
    pub local_port: u16,
}

impl ServerConfig {
    pub fn build_uri(&self, schema: &str, path_and_query: &str) -> String {
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
    sender: Sender<UserEvent>,
    client_count: Arc<AtomicU8>,
}

pub struct Server {
    app: Router,
    listener: TcpListener,
    sender: Sender<UserEvent>,
    // Used for opening a browser tab if there is no opened tabs
    broswer_sender: mpsc::Sender<UserEvent>,
    client_count: Arc<AtomicU8>,
}

impl Server {
    pub async fn build_server(
        sender: Sender<UserEvent>,
        broswer_sender: mpsc::Sender<UserEvent>,
        radio: AnyRadio,
        server_config: ServerConfig,
        use_local_ui: bool,
    ) -> Result<Self> {
        let client_count = Arc::new(AtomicU8::new(0));
        let http_client = Client::new();

        let app = Router::new()
            .route("/radio", any(cat_control_handler))
            .route(
                "/submit_spot",
                any(|state, websocket| websocket_handler(state, websocket, "/submit_spot")),
            )
            .route(
                "/spots_ws",
                any(|state, websocket| websocket_handler(state, websocket, "/spots_ws")),
            )
            .route("/exit", post(exit_server_handler))
            .route("/open", post(open_tab_handler));

        let app_state = AppState {
            server_config,
            radio,
            http_client,
            sender: sender.clone(),
            client_count: client_count.clone(),
        };
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
            app.route("/spots", any(proxy)).fallback_service(
                ServeDir::new(ui_dir).fallback(any(proxy).with_state(app_state.clone())),
            )
        } else {
            app.fallback(any(proxy))
        };
        let local_port = app_state.server_config.local_port;
        let app = app.with_state(app_state);

        let address = SocketAddrV4::new(Ipv4Addr::new(0, 0, 0, 0), local_port);
        let listener = TcpListener::bind(address).await?;
        Ok(Self {
            app,
            listener,
            sender,
            broswer_sender,
            client_count,
        })
    }

    pub async fn run_server(self) -> Result<()> {
        let mut receiver = self.sender.subscribe();
        let browser_task = tokio::spawn(async move {
            loop {
                match receiver.recv().await? {
                    UserEvent::Quit => {
                        break;
                    }
                    UserEvent::OpenBrowser => {
                        if self.client_count.load(Ordering::SeqCst) == 0 {
                            self.broswer_sender.send(UserEvent::OpenBrowser).await?;
                        }
                    }
                }
            }
            Ok::<(), anyhow::Error>(())
        });

        let server = axum::serve(self.listener, self.app)
            .with_graceful_shutdown(shutdown(self.sender.subscribe()));

        let (browser_result, server_result) = tokio::join!(browser_task, server);
        server_result.map_err(|err| anyhow!(err)).and(
            browser_result
                .map_err(|err| anyhow!(err))
                .and_then(|err| err),
        )
    }
}

async fn shutdown(mut receiver: Receiver<UserEvent>) {
    while let Ok(message) = receiver.recv().await
        && message != UserEvent::Quit
    {
        // Waiting
    }
}

async fn proxy(State(state): State<AppState>, request: Request<Body>) -> Response<Body> {
    let uri = state.server_config.build_uri(
        "http",
        request
            .uri()
            .path_and_query()
            .map(|x| x.as_str())
            .unwrap_or(""),
    );

    let reqwest_response = match state.http_client.get(uri).send().await {
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

async fn exit_server_handler(State(state): State<AppState>) -> impl IntoResponse {
    let _ = state.sender.send(UserEvent::Quit);
    StatusCode::OK
}

async fn open_tab_handler(State(state): State<AppState>) -> impl IntoResponse {
    let _ = state.sender.send(UserEvent::OpenBrowser);
    StatusCode::OK
}

async fn websocket_handler(
    State(state): State<AppState>,
    websocket: WebSocketUpgrade,
    path: &'static str,
) -> impl IntoResponse {
    websocket
        .write_buffer_size(0)
        .read_buffer_size(0)
        .accept_unmasked_frames(true)
        .on_upgrade(async |websocket: WebSocket| {
            handle_websocket(state.server_config, websocket, path)
                .await
                .unwrap()
        })
}

async fn handle_websocket(
    server_config: ServerConfig,
    client_socket: WebSocket,
    path: &str,
) -> Result<()> {
    let (mut client_sender, mut client_receiver) = client_socket.split();
    let (stream, _response) = connect_async(server_config.build_uri("ws", path)).await?;
    let (mut server_sender, mut server_receiver) = stream.split();

    use tokio_tungstenite::tungstenite;

    loop {
        tokio::select! {
            Some(Ok(message)) = client_receiver.next() => {
                let result = server_sender
                    .send(utils::axum_to_tungstenite_message(message))
                    .await;
                if let Err(error) = &result {
                    use tungstenite::Error;
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
            Some(Ok(message)) = server_receiver.next() => {
                let result = client_sender
                    .send(utils::tungstenite_to_axum_message(message))
                    .await;
                if result.is_err() {
                    break;
                }
            }
        }
    }

    // This is best effort, so we ignore errors
    let _ = server_sender
        .send(tungstenite::Message::Close(Some(
            tungstenite::protocol::CloseFrame {
                code: tungstenite::protocol::frame::coding::CloseCode::Normal,
                reason: tungstenite::Utf8Bytes::from_static("Goodbye"),
            },
        )))
        .await;
    let _ = client_sender
        .send(Message::Close(Some(axum::extract::ws::CloseFrame {
            code: axum::extract::ws::close_code::NORMAL,
            reason: axum::extract::ws::Utf8Bytes::from_static("Goodbye"),
        })))
        .await;

    Ok(())
}

async fn cat_control_handler(
    websocket: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let receiver = state.sender.subscribe();
    let client_count = state.client_count.clone();

    websocket
        .write_buffer_size(0)
        .read_buffer_size(0)
        .accept_unmasked_frames(true)
        .on_upgrade(async move |websocket: WebSocket| {
            client_count.fetch_add(1, Ordering::SeqCst);
            let result = handle_cat_control_socket(websocket, state.radio, receiver).await;
            client_count.fetch_sub(1, Ordering::SeqCst);
            result.unwrap();
        })
}

async fn handle_cat_control_socket(
    socket: WebSocket,
    radio: AnyRadio,
    mut receiver: Receiver<UserEvent>,
) -> Result<()> {
    let (mut client_sender, mut client_receiver) = socket.split();

    let message = InitMessage {
        status: "connected".into(),
        version: env!("VERSION").into(),
    };
    let message = Message::Text(serde_json::to_string(&message)?.into());
    client_sender.send(message).await?;

    let mut interval = tokio::time::interval(Duration::from_millis(500));
    let mut previous_data = None;

    loop {
        tokio::select! {
            Some(message) = client_receiver.next() => {
                match message? {
                    Message::Text(text) => {
                        process_message(text.to_string(), &radio)?;
                        let status = radio.write().get_status();
                        let message = Message::Text(serde_json::to_string(&status)?.into());
                        client_sender.send(message).await?;
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
            },
            event = receiver.recv() => {
                match event? {
                    UserEvent::Quit => {
                        #[derive(Serialize)]
                        struct CloseMessage {
                            close: bool,
                        }

                        let message = CloseMessage { close: true };
                        let message = Message::Text(serde_json::to_string(&message)?.into());
                        let _ = client_sender.send(message).await;
                        break;
                    },
                    UserEvent::OpenBrowser => {
                        #[derive(Serialize)]
                        struct FocusMessage {
                            focus: bool,
                        }
                        let message = FocusMessage { focus: true };
                        let message = Message::Text(serde_json::to_string(&message)?.into());
                        client_sender.send(message).await?;
                    },
                }
            },
            _ = interval.tick() => {
                let data = radio.write().get_status();
                if previous_data.as_ref() != Some(&data) {
                    let message = Message::Text(serde_json::to_string(&data)?.into());
                    client_sender.send(message).await?;
                    previous_data = Some(data);
                }
            }
        }
    }

    Ok(())
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

fn process_message(message: String, radio: &AnyRadio) -> Result<()> {
    let message: ClientMessage = serde_json::from_str(&message)
        .with_context(|| format!("Failed to parse message: {message}"))?;
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

#![windows_subsystem = "windows"]

use anyhow::{Context, Result, bail};
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
use single_instance::SingleInstance;
use tokio::sync::{
    broadcast::{self, Receiver},
    mpsc::{self},
};
use tokio_tungstenite::connect_async;
use tower_http::services::ServeDir;

mod dummy;
mod omnirig;
mod rig;
mod tray_icon;
mod utils;

use dummy::DummyRadio;
use rig::{AnyRadio, Mode, Slot};
use tray_icon::IconTrayEvent;

const HOLY_CLUSTER_DNS: &str = "holycluster.iarc.org";
const LOCAL_PORT: u16 = 3000;

fn open_at_browser() -> Result<()> {
    open::that(format!("http://127.0.0.1:{LOCAL_PORT}"))?;
    Ok(())
}

fn main() -> Result<()> {
    let instance = SingleInstance::new("HolyCluster")?;
    if instance.is_single() {
        let (tray_sender, tray_receiver) = broadcast::channel::<IconTrayEvent>(10);
        let quit_reciever = tray_sender.subscribe();

        let _thread = std::thread::Builder::new()
            .name("tray-icon".into())
            .spawn(|| {
                run_singleton_instance(quit_reciever, tray_receiver).unwrap();
            });
        tray_icon::run_tray_icon(tray_sender);
    } else {
        open_at_browser()?;
    }
    Ok(())
}

#[tokio::main]
async fn run_singleton_instance(
    quit_receiver: Receiver<IconTrayEvent>,
    mut tray_receiver: Receiver<IconTrayEvent>,
) -> Result<()> {
    let client = Client::new();

    let radio = if cfg!(windows) {
        use omnirig::OmnirigRadio;

        if std::env::var("DUMMY").is_ok() {
            AnyRadio::new(DummyRadio::new())
        } else {
            println!("Using omnirig");
            AnyRadio::new(OmnirigRadio::new())
        }
    } else {
        if std::env::var("DUMMY").is_ok() {
            println!("DUMMY env variable doesn't have any affect in linux!");
        }
        AnyRadio::new(DummyRadio::new())
    };
    radio.write().init();

    println!("Radio initialized");
    let app = Router::new()
        .route("/radio", any(cat_control_handler))
        .with_state(radio)
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

    open_at_browser()?;

    tokio::spawn(async move {
        while let Ok(message) = tray_receiver.recv().await {
            if message == IconTrayEvent::OpenBrowser {
                open_at_browser().unwrap();
            }
        }
    });

    println!("Running webapp");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown(quit_receiver))
        .await?;
    Ok(())
}

async fn shutdown(mut quit_receiver: Receiver<IconTrayEvent>) {
    while let Ok(message) = quit_receiver.recv().await {
        if message == IconTrayEvent::Quit {
            break;
        }
    }
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
    if let Some(headers) = response_builder.headers_mut() {
        *headers = reqwest_response.headers().clone();
    }
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

async fn cat_control_handler(
    websocket: WebSocketUpgrade,
    State(radio): State<AnyRadio>,
) -> impl IntoResponse {
    websocket
        .write_buffer_size(0)
        .read_buffer_size(0)
        .accept_unmasked_frames(true)
        .on_upgrade(|websocket: WebSocket| handle_cat_control_socket(websocket, radio))
}

async fn handle_cat_control_socket(socket: WebSocket, radio: AnyRadio) {
    let (mut sender_inner, mut receiver) = socket.split();

    let (sender, mut sender_recv) = mpsc::unbounded_channel::<Message>();

    let mut send_task = tokio::spawn(async move {
        while let Some(message) = sender_recv.recv().await {
            if sender_inner.send(message).await.is_err() {
                break;
            }
        }

        let _ = sender_inner
            .send(Message::Close(Some(CloseFrame {
                code: axum::extract::ws::close_code::NORMAL,
                reason: Utf8Bytes::from_static("Goodbye"),
            })))
            .await;
    });

    let poll_radio = radio.clone();
    let poll_sender = sender.clone();
    let mut poll_task = tokio::spawn(async move {
        let message = StatusMessage {
            status: "connected".to_string(),
        };
        let radio = poll_radio.clone();
        let sender = poll_sender;

        sender
            .send(Message::Text(
                serde_json::to_string(&message).unwrap().into(),
            ))
            .unwrap();

        loop {
            let data = radio.write().get_status();
            let message = Message::Text(serde_json::to_string(&data).unwrap().into());
            if sender.send(message).is_err() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    });

    let command_radio = radio.clone();
    let command_sender = sender.clone();
    let mut command_task = tokio::spawn(async move {
        let radio = command_radio.clone();
        let sender = command_sender;

        while let Some(Ok(message)) = receiver.next().await {
            match message {
                Message::Text(text) => {
                    process_message(text.to_string(), radio.clone()).unwrap();
                    let status = radio.write().get_status();
                    let message = Message::Text(serde_json::to_string(&status).unwrap().into());
                    sender.send(message).unwrap();
                }
                Message::Binary(_data) => {}
                Message::Close(_) => {
                    break;
                }
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = (&mut send_task) => {
            command_task.abort();
            poll_task.abort();
        },
        _ = (&mut poll_task) => {
            command_task.abort();
            send_task.abort();
        },
        _ = (&mut command_task) => {
            poll_task.abort();
            send_task.abort();
        }
    }
}

#[derive(Serialize)]
struct StatusMessage {
    status: String,
}

#[derive(Deserialize)]
struct SetModeAndFreq {
    mode: String,
    freq: u32,
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
            radio.write().set_rig(set_rig.rig);
        }
        ClientMessage::SetModeAndFreq(set_mode_and_freq) => {
            let is_upper = !matches!(set_mode_and_freq.band, 160 | 80 | 40);
            let mode = match (set_mode_and_freq.mode.as_str(), is_upper) {
                ("SSB", true) => Mode::USB,
                ("SSB", false) => Mode::LSB,
                ("DIGI" | "FT8" | "FT4", _) => Mode::Data,
                ("CW", true) => Mode::CWUpper,
                ("CW", false) => Mode::CWLower,
                (mode, is_upper) => {
                    bail!("Unknown mode: {mode}, is upper: {is_upper}");
                }
            };
            radio.write().set_mode(mode);
            radio.write().set_frequency(Slot::A, set_mode_and_freq.freq);
        }
    }
    Ok(())
}

use std::time::Duration;

use anyhow::Result;
use axum::extract::{
    State, WebSocketUpgrade,
    ws::{Message, WebSocket},
};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast::Receiver;
use tokio_tungstenite::connect_async;

use crate::{radio_manager::RadioManager, rotator::AnyRotator, tray_icon::UserEvent, utils};

use super::{ServerConfig, radio, radio_actions, rotator, state::AppState};

pub(super) async fn cat_control_handler(
    websocket: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl axum::response::IntoResponse {
    let receiver = state.sender.subscribe();
    websocket
        .write_buffer_size(0)
        .read_buffer_size(0)
        .accept_unmasked_frames(true)
        .on_upgrade(move |websocket| async move {
            if let Err(error) = handle_cat_control_socket(
                websocket,
                state.radio,
                state.radio_configuration,
                receiver,
            )
            .await
            {
                tracing::error!(?error, "CAT control WebSocket handler failed");
            }
        })
}

pub(super) async fn ws_handler(
    websocket: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl axum::response::IntoResponse {
    let receiver = state.sender.subscribe();
    websocket
        .write_buffer_size(0)
        .read_buffer_size(0)
        .accept_unmasked_frames(true)
        .on_upgrade(move |websocket| async move {
            if let Err(error) = handle_ws_socket(
                websocket,
                state.server_config,
                state.radio,
                state.radio_configuration,
                state.rotator,
                receiver,
            )
            .await
            {
                tracing::error!(?error, "Unified WebSocket handler failed");
            }
        })
}

async fn handle_ws_socket(
    socket: WebSocket,
    server_config: ServerConfig,
    radio_manager: RadioManager,
    radio_configuration: super::radio_configuration::RadioConfiguration,
    rotator_device: AnyRotator,
    mut receiver: Receiver<UserEvent>,
) -> Result<()> {
    let (mut client_sender, mut client_receiver) = socket.split();
    let (stream, _) = connect_async(server_config.build_uri("ws", "/ws")).await?;
    let (mut server_sender, mut server_receiver) = stream.split();
    client_sender.send(radio::init_message()?).await?;
    let rotator_status = rotator_device.write().get_status();
    client_sender
        .send(rotator::status_message(&rotator_status)?)
        .await?;
    let mut radio_interval = tokio::time::interval(Duration::from_millis(500));
    let mut rotator_interval = tokio::time::interval(Duration::from_millis(1000));
    let mut previous_radio_data = None;
    let mut previous_rotator_data = None;
    loop {
        tokio::select! {
            Some(message) = client_receiver.next() => match message? {
                Message::Text(text) if radio_actions::is_message(text.as_ref()) => {
                    if let Some(response) = radio_actions::process_ws(text.to_string(), &radio_manager, &radio_configuration).await? {
                        client_sender.send(response).await?;
                    }
                    client_sender.send(radio::status_message(&radio_manager.status(), &radio_manager)?).await?;
                }
                Message::Text(text) if rotator::is_message(text.as_ref()) => rotator::process(text.to_string(), &rotator_device).await?,
                Message::Text(text) => {
                    if forward_to_server(&mut server_sender, utils::axum_to_tungstenite_message(Message::Text(text))).await? { break; }
                }
                Message::Close(_) => break,
                message => if forward_to_server(&mut server_sender, utils::axum_to_tungstenite_message(message)).await? { break; },
            },
            Some(Ok(message)) = server_receiver.next() => {
                let Some(message) = utils::tungstenite_to_axum_message(message) else { continue; };
                if client_sender.send(message).await.is_err() { break; }
            }
            event = receiver.recv() => match event? {
                UserEvent::Quit => {
                    let _ = client_sender.send(radio::close_message()?).await;
                    break;
                }
                UserEvent::OpenBrowser => client_sender.send(radio::focus_message()?).await?,
            },
            _ = radio_interval.tick() => {
                let data = radio_manager.poll_status().await;
                if previous_radio_data.as_ref() != Some(&data) {
                    client_sender.send(radio::status_message(&data, &radio_manager)?).await?;
                    previous_radio_data = Some(data);
                }
            }
            _ = rotator_interval.tick() => {
                let data = rotator_device.write().get_status();
                if previous_rotator_data.as_ref() != Some(&data) {
                    client_sender.send(rotator::status_message(&data)?).await?;
                    previous_rotator_data = Some(data);
                }
            }
        }
    }
    let _ = server_sender
        .send(tokio_tungstenite::tungstenite::Message::Close(Some(
            tokio_tungstenite::tungstenite::protocol::CloseFrame {
                code: tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Normal,
                reason: tokio_tungstenite::tungstenite::Utf8Bytes::from_static("Goodbye"),
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

async fn forward_to_server(
    sender: &mut futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        tokio_tungstenite::tungstenite::Message,
    >,
    message: tokio_tungstenite::tungstenite::Message,
) -> Result<bool> {
    match sender.send(message).await {
        Ok(()) => Ok(false),
        Err(tokio_tungstenite::tungstenite::Error::ConnectionClosed) => Ok(true),
        Err(error) => Err(error.into()),
    }
}

async fn handle_cat_control_socket(
    socket: WebSocket,
    radio_manager: RadioManager,
    radio_configuration: super::radio_configuration::RadioConfiguration,
    mut receiver: Receiver<UserEvent>,
) -> Result<()> {
    let (mut client_sender, mut client_receiver) = socket.split();
    client_sender.send(radio::legacy_init_message()?).await?;
    let mut interval = tokio::time::interval(Duration::from_millis(500));
    let mut previous_data = None;
    loop {
        tokio::select! {
            Some(message) = client_receiver.next() => match message? {
                Message::Text(text) => {
                    if let Some(response) = radio_actions::process_legacy(text.to_string(), &radio_manager, &radio_configuration).await? {
                        client_sender.send(response).await?;
                    }
                    client_sender.send(radio::legacy_status_message(&radio_manager.status(), &radio_manager)?).await?;
                }
                Message::Binary(data) => tracing::warn!("Ignoring binary data: {data:?}"),
                Message::Close(_) => break,
                message => tracing::warn!("Ignoring message: {message:?}"),
            },
            event = receiver.recv() => match event? {
                UserEvent::Quit => { let _ = client_sender.send(radio::legacy_close_message()?).await; break; }
                UserEvent::OpenBrowser => client_sender.send(radio::legacy_focus_message()?).await?,
            },
            _ = interval.tick() => {
                let data = radio_manager.poll_status().await;
                if previous_data.as_ref() != Some(&data) {
                    client_sender.send(radio::legacy_status_message(&data, &radio_manager)?).await?;
                    previous_data = Some(data);
                }
            }
        }
    }
    Ok(())
}

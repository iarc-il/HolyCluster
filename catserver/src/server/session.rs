use std::time::Duration;

use anyhow::{Result, anyhow};
use axum::extract::{
    State, WebSocketUpgrade,
    ws::{Message, WebSocket},
};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast::Receiver;
use tokio_tungstenite::connect_async;

use crate::{
    radio_manager::RadioManager, rotator_manager::RotatorManager, tray_icon::UserEvent, utils,
};

use super::{
    ServerConfig, availability_trace::AvailabilityTrace, radio, radio_actions, rotator,
    state::AppState,
};

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
            let availability = state.upstream_websocket_trace.clone();
            if let Err(error) = handle_ws_socket(
                websocket,
                state.server_config,
                state.radio,
                state.radio_configuration,
                state.rotator,
                state.rotator_configuration,
                receiver,
                availability.clone(),
            )
            .await
            {
                tracing::debug!(%error, "Unified WebSocket session ended");
            }
        })
}

#[allow(clippy::too_many_arguments)]
async fn handle_ws_socket(
    socket: WebSocket,
    server_config: ServerConfig,
    radio_manager: RadioManager,
    radio_configuration: super::radio_configuration::RadioConfiguration,
    rotator_manager: RotatorManager,
    rotator_configuration: super::rotator_configuration::RotatorConfiguration,
    mut receiver: Receiver<UserEvent>,
    availability: AvailabilityTrace,
) -> Result<()> {
    let (mut client_sender, mut client_receiver) = socket.split();
    let (stream, _) = match connect_async(server_config.build_uri("ws", "/ws")).await {
        Ok(connection) => connection,
        Err(error) => {
            availability.unavailable(&error);
            return Err(error.into());
        }
    };
    let mut upstream_connection = availability.connection();
    let (mut server_sender, mut server_receiver) = stream.split();
    client_sender.send(radio::init_message()?).await?;
    let rotator_status = rotator_manager.status();
    client_sender
        .send(rotator::status_message(&rotator_status)?)
        .await?;
    let mut radio_interval = tokio::time::interval(Duration::from_millis(500));
    let mut rotator_interval = tokio::time::interval(Duration::from_millis(1000));
    let mut previous_radio_data = None;
    let mut previous_rotator_data = None;
    let mut upstream_receiver_open = true;
    let mut upstream_receiver_failed = false;
    loop {
        tokio::select! {
            Some(message) = client_receiver.next() => match message? {
                Message::Text(text) if radio_actions::is_message(text.as_ref()) => {
                    if let Some(response) = radio_actions::process_ws(text.to_string(), &radio_manager, &radio_configuration).await? {
                        client_sender.send(response).await?;
                    }
                    client_sender.send(radio::status_message(&radio_manager.status(), &radio_manager)?).await?;
                }
                Message::Text(text) if rotator::is_message(text.as_ref()) => {
                    if let Some(response) = rotator::process(text.to_string(), &rotator_manager, &rotator_configuration).await? {
                        client_sender.send(response).await?;
                    }
                    client_sender.send(rotator::status_message(&rotator_manager.status())?).await?;
                },
                Message::Text(text) => {
                    if forward_to_server(
                        &mut server_sender,
                        utils::axum_to_tungstenite_message(Message::Text(text)),
                        &mut upstream_connection,
                    ).await? { break; }
                }
                Message::Close(_) => break,
                message => if forward_to_server(
                    &mut server_sender,
                    utils::axum_to_tungstenite_message(message),
                    &mut upstream_connection,
                ).await? { break; },
            },
            message = server_receiver.next(), if upstream_receiver_open => match message {
                Some(Ok(message)) => {
                    if upstream_receiver_failed {
                        upstream_connection = availability.connection();
                        upstream_receiver_failed = false;
                    }
                    let Some(message) = utils::tungstenite_to_axum_message(message) else { continue; };
                    if client_sender.send(message).await.is_err() { break; }
                }
                Some(Err(error)) => {
                    upstream_connection.unavailable(&error);
                    upstream_receiver_failed = true;
                }
                None => {
                    upstream_connection.unavailable(&anyhow!("upstream WebSocket closed"));
                    upstream_receiver_open = false;
                }
            },
            event = receiver.recv() => match event? {
                UserEvent::Quit => {
                    let _ = client_sender.send(radio::close_message()?).await;
                    break;
                }
                UserEvent::OpenBrowser => client_sender.send(radio::focus_message()?).await?,
            },
            _ = radio_interval.tick() => {
                let data = radio_manager.status();
                if previous_radio_data.as_ref() != Some(&data) {
                    client_sender.send(radio::status_message(&data, &radio_manager)?).await?;
                    previous_radio_data = Some(data);
                }
            }
            _ = rotator_interval.tick() => {
                let data = rotator_manager.status();
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
    availability: &mut super::availability_trace::AvailabilityConnection,
) -> Result<bool> {
    match sender.send(message).await {
        Ok(()) => Ok(false),
        Err(error @ tokio_tungstenite::tungstenite::Error::ConnectionClosed) => {
            availability.unavailable(&error);
            Ok(true)
        }
        Err(error) => {
            availability.unavailable(&error);
            Err(error.into())
        }
    }
}

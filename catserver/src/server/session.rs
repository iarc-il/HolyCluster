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
    state::AppState, update,
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
                state.updater,
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
    updater: crate::updater::UpdateService,
) -> Result<()> {
    let (mut client_sender, mut client_receiver) = socket.split();
    // Connecting (including retries) is polled alongside local CAT work. Dropping
    // this future on shutdown also cancels any pending handshake.
    let connect = async {
        loop {
            match tokio::time::timeout(
                Duration::from_secs(10),
                connect_async(server_config.build_uri("ws", "/ws")),
            )
            .await
            {
                Ok(Ok((stream, _))) => break stream,
                Ok(Err(error)) => availability.unavailable(&error),
                Err(error) => availability.unavailable(&error),
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    };
    tokio::pin!(connect);
    let mut server_sender = None;
    let mut server_receiver: Option<
        futures_util::stream::SplitStream<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
        >,
    > = None;
    let mut upstream_connection = None;
    // Only one bounded, idempotent subscription may survive an initial outage.
    let mut pending_subscription = None;
    client_sender.send(radio::init_message()?).await?;
    let rotator_status = rotator_manager.status();
    client_sender
        .send(rotator::status_message(&rotator_status)?)
        .await?;
    let mut radio_interval = tokio::time::interval(Duration::from_millis(500));
    let mut rotator_interval = tokio::time::interval(Duration::from_millis(1000));
    let mut previous_radio_data = None;
    let mut previous_rotator_data = None;
    let mut client_close_code = axum::extract::ws::close_code::NORMAL;
    loop {
        tokio::select! {
            stream = &mut connect, if server_sender.is_none() => {
                let (sender, receiver) = stream.split();
                server_sender = Some(sender);
                server_receiver = Some(receiver);
                upstream_connection = Some(availability.connection());
                if let Some(message) = pending_subscription.take()
                    && forward_to_server(
                        server_sender.as_mut().unwrap(),
                        message,
                        upstream_connection.as_mut().unwrap(),
                    ).await?
                {
                    client_close_code = axum::extract::ws::close_code::RESTART;
                    break;
                }
            },
            message = client_receiver.next() => match message {
                None => break,
                Some(message) => match message? {
                Message::Text(text) if radio_actions::is_message(text.as_ref()) => {
                    match radio_actions::process_ws(text.to_string(), &radio_manager, &radio_configuration).await {
                        Ok(Some(response)) => client_sender.send(response).await?,
                        Ok(None) => {}
                        Err(error) => tracing::error!(%error, "Failed to process radio WebSocket message"),
                    }
                    client_sender.send(radio::status_message(&radio_manager.status(), &radio_manager)?).await?;
                }
                Message::Text(text) if rotator::is_message(text.as_ref()) => {
                    match rotator::process(text.to_string(), &rotator_manager, &rotator_configuration).await {
                        Ok(Some(response)) => client_sender.send(response).await?,
                        Ok(None) => {}
                        Err(error) => tracing::error!(%error, "Failed to process rotator WebSocket message"),
                    }
                    client_sender.send(rotator::status_message(&rotator_manager.status())?).await?;
                },
                Message::Text(text) => {
                    if let Some(sender) = server_sender.as_mut() {
                        if forward_to_server(
                            sender,
                            utils::axum_to_tungstenite_message(Message::Text(text)),
                            upstream_connection.as_mut().unwrap(),
                        ).await? {
                            client_close_code = axum::extract::ws::close_code::RESTART;
                            break;
                        }
                    } else if is_spots_subscription(text.as_ref()) {
                        pending_subscription = Some(utils::axum_to_tungstenite_message(Message::Text(text)));
                    } else if serde_json::from_str::<serde_json::Value>(text.as_ref())
                        .is_ok_and(|message| message["version"] == 1 && message["type"] == "submit")
                    {
                        client_sender.send(Message::Text(serde_json::json!({
                            "version": 1, "type": "submit", "status": "failure",
                            "error_type": "BackendUnavailable",
                            "error_data": "The backend is unavailable. The spot was not submitted."
                        }).to_string().into())).await?;
                    } else {
                        // Do not silently lose history requests or replay commands.
                        client_close_code = axum::extract::ws::close_code::RESTART;
                        break;
                    }
                }
                Message::Close(_) => break,
                Message::Ping(data) => client_sender.send(Message::Pong(data)).await?,
                Message::Pong(_) => {},
                message => if let Some(sender) = server_sender.as_mut() {
                    if forward_to_server(
                        sender,
                        utils::axum_to_tungstenite_message(message),
                        upstream_connection.as_mut().unwrap(),
                    ).await? {
                        client_close_code = axum::extract::ws::close_code::RESTART;
                        break;
                    }
                } else {
                    client_close_code = axum::extract::ws::close_code::RESTART;
                    break;
                },
                }
            },
            message = async { server_receiver.as_mut().unwrap().next().await }, if server_receiver.is_some() => match message {
                Some(Ok(message)) => {
                    let closing = matches!(message, tokio_tungstenite::tungstenite::Message::Close(_));
                    let Some(message) = utils::tungstenite_to_axum_message(message) else { continue; };
                    if client_sender.send(message).await.is_err() || closing { break; }
                }
                Some(Err(error)) => {
                    upstream_connection.as_mut().unwrap().unavailable(&error);
                    client_close_code = axum::extract::ws::close_code::RESTART;
                    break;
                }
                None => {
                    upstream_connection.as_mut().unwrap().unavailable(&anyhow!("upstream WebSocket closed"));
                    client_close_code = axum::extract::ws::close_code::RESTART;
                    break;
                }
            },
            event = receiver.recv() => match event? {
                UserEvent::Quit => {
                    let _ = client_sender.send(radio::close_message()?).await;
                    break;
                }
                UserEvent::RestartForUpdate => {
                    let _ = client_sender.send(update::restart_message(updater.session())).await;
                    client_close_code = axum::extract::ws::close_code::RESTART;
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
    if let Some(server_sender) = server_sender.as_mut() {
        let _ = tokio::time::timeout(
            Duration::from_secs(1),
            server_sender.send(tokio_tungstenite::tungstenite::Message::Close(Some(
                tokio_tungstenite::tungstenite::protocol::CloseFrame {
                    code:
                        tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Normal,
                    reason: tokio_tungstenite::tungstenite::Utf8Bytes::from_static("Goodbye"),
                },
            ))),
        )
        .await;
    }
    let _ = tokio::time::timeout(
        Duration::from_secs(1),
        client_sender.send(Message::Close(Some(axum::extract::ws::CloseFrame {
            code: client_close_code,
            reason: axum::extract::ws::Utf8Bytes::from_static("Goodbye"),
        }))),
    )
    .await;
    Ok(())
}

fn is_spots_subscription(text: &str) -> bool {
    if text.len() > 4096 {
        return false;
    }
    serde_json::from_str::<serde_json::Value>(text).is_ok_and(|message| {
        message["version"] == 1
            && message["type"] == "spots"
            && (message["action"] == "initial"
                || (message["action"] == "catch_up" && message["last_time"].is_number()))
    })
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
            Ok(true)
        }
    }
}

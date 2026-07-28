use anyhow::Result;
use axum::extract::ws::Message;
use serde::Serialize;

use crate::{
    radio_config::{ActiveRadioBackend, RadioBackendKind},
    radio_manager::{ConnectionState, RadioManager},
    rig::Status,
};

const VERSION: u8 = 1;
const TYPE: &str = "radio";

#[derive(Serialize)]
struct ServerMessage<'a, T: Serialize> {
    version: u8,
    #[serde(rename = "type")]
    message_type: &'static str,
    event: &'static str,
    #[serde(flatten)]
    data: &'a T,
}

#[derive(Serialize)]
struct RadioInitMessage {
    status: String,
    catserver_version: String,
}

#[derive(Serialize)]
struct BoolMessage {
    focus: bool,
}

pub(super) fn init_message() -> Result<Message> {
    message(
        "status",
        &RadioInitMessage {
            status: "connected".into(),
            catserver_version: env!("VERSION").into(),
        },
    )
}

pub(super) fn status_message(data: &Status, radio: &RadioManager) -> Result<Message> {
    message("status", &status_data(data, radio))
}
pub(super) fn focus_message() -> Result<Message> {
    message("focus", &BoolMessage { focus: true })
}
pub(super) fn close_message() -> Result<Message> {
    message("close", &serde_json::json!({"close": true}))
}

fn status_data(data: &Status, radio: &RadioManager) -> serde_json::Value {
    let snapshot = radio.snapshot();
    serde_json::json!({"freq": data.freq, "status": data.status, "mode": data.mode, "current_rig": data.current_rig, "backend": backend(snapshot.selected), "connection": connection(snapshot.connection), "error": snapshot.last_error.map(|error| error.to_string()), "features": ["radio_configuration"]})
}

fn backend(backend: ActiveRadioBackend) -> &'static str {
    match backend {
        ActiveRadioBackend::Dummy => "dummy",
        ActiveRadioBackend::Configured(RadioBackendKind::Omnirig) => "omnirig",
        ActiveRadioBackend::Configured(RadioBackendKind::Rigctld) => "rigctld",
        ActiveRadioBackend::Configured(RadioBackendKind::Hamlib) => "hamlib",
    }
}

fn connection(connection: ConnectionState) -> &'static str {
    match connection {
        ConnectionState::Connected => "connected",
        ConnectionState::Disconnected => "disconnected",
    }
}

pub(super) fn message<T: Serialize>(event: &'static str, data: &T) -> Result<Message> {
    Ok(Message::Text(
        serde_json::to_string(&ServerMessage {
            version: VERSION,
            message_type: TYPE,
            event,
            data,
        })?
        .into(),
    ))
}

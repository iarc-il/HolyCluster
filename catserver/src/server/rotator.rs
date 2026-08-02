use anyhow::Result;
use axum::extract::ws::Message;
use serde::{Deserialize, Serialize};

use crate::rotator::AnyRotator;

const VERSION: u8 = 1;
const TYPE: &str = "rotator";

#[derive(Serialize)]
struct ServerMessage<'a, T: Serialize> {
    version: u8,
    #[serde(rename = "type")]
    message_type: &'static str,
    event: &'static str,
    #[serde(flatten)]
    data: &'a T,
}

#[derive(Deserialize)]
struct Envelope {
    version: u8,
    #[serde(rename = "type")]
    message_type: String,
}

#[derive(Deserialize)]
#[serde(tag = "action")]
enum ClientMessage {
    SetAzimuth { azimuth: f64 },
}

pub(super) fn status_message<T: Serialize>(data: &T) -> Result<Message> {
    Ok(Message::Text(
        serde_json::to_string(&ServerMessage {
            version: VERSION,
            message_type: TYPE,
            event: "status",
            data,
        })?
        .into(),
    ))
}

pub(super) fn is_message(message: &str) -> bool {
    serde_json::from_str::<Envelope>(message)
        .is_ok_and(|message| message.version == VERSION && message.message_type == TYPE)
}

pub(super) async fn process(message: String, rotator: &AnyRotator) -> Result<()> {
    let Ok(message) = serde_json::from_str::<ClientMessage>(&message) else {
        tracing::error!("Failed to parse rotator message: {message}");
        return Ok(());
    };
    match message {
        ClientMessage::SetAzimuth { azimuth } => {
            tracing::debug!("Setting azimuth to {azimuth}");
            rotator.write().set_azimuth(azimuth);
        }
    }
    Ok(())
}

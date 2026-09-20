use anyhow::Result;
use axum::extract::ws::Message;
use serde::{Deserialize, Serialize};

use crate::{rotator_config::RotatorConfig, rotator_manager::RotatorManager};

use super::rotator_configuration::RotatorConfiguration;

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
    ListRotatorModels,
    DescribeRotatorModel { model_id: String },
    GetRotatorConfiguration,
    SetRotatorConfiguration { configuration: RotatorConfig },
    TestRotatorConnection { configuration: RotatorConfig },
    RetryRotator,
}

pub(super) fn status_message<T: Serialize>(data: &T) -> Result<Message> {
    message("status", data)
}

fn message<T: Serialize>(event: &'static str, data: &T) -> Result<Message> {
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

pub(super) fn is_message(message: &str) -> bool {
    serde_json::from_str::<Envelope>(message)
        .is_ok_and(|message| message.version == VERSION && message.message_type == TYPE)
}

pub(super) async fn process(
    message_text: String,
    rotator: &RotatorManager,
    service: &RotatorConfiguration,
) -> Result<Option<Message>> {
    let Ok(request) = serde_json::from_str::<ClientMessage>(&message_text) else {
        tracing::error!(message = message_text, "Failed to parse rotator message");
        return Ok(None);
    };
    let (event, data) = match request {
        ClientMessage::SetAzimuth { azimuth } => {
            if let Err(error) = rotator.set_azimuth(azimuth).await {
                tracing::error!(?error, "Failed to set rotator azimuth");
            }
            return Ok(None);
        }
        ClientMessage::ListRotatorModels => (
            "rotator_models",
            service
                .models()
                .map(|models| serde_json::json!({"models": models}))
                .unwrap_or_else(|error| serde_json::json!({"error": error})),
        ),
        ClientMessage::DescribeRotatorModel { model_id } => (
            "rotator_model",
            match service.describe(&model_id) {
                Ok(descriptors) => {
                    serde_json::json!({"model_id": model_id, "descriptors": descriptors})
                }
                Err(error) => serde_json::json!({"model_id": model_id, "error": error}),
            },
        ),
        ClientMessage::GetRotatorConfiguration => (
            "rotator_configuration",
            serde_json::to_value(service.configuration())?,
        ),
        ClientMessage::SetRotatorConfiguration { configuration } => (
            "rotator_configuration_result",
            serde_json::to_value(service.apply(configuration).await)?,
        ),
        ClientMessage::TestRotatorConnection { configuration } => (
            "rotator_connection_result",
            serde_json::to_value(service.test(configuration).await)?,
        ),
        ClientMessage::RetryRotator => {
            service.retry().await?;
            (
                "rotator_configuration_result",
                serde_json::json!({"ok": true}),
            )
        }
    };
    Ok(Some(message(event, &data)?))
}

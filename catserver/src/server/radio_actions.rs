use anyhow::Result;
use axum::extract::ws::Message;
use serde::Deserialize;

use crate::{radio_config::RadioConfig, radio_manager::RadioManager};

use super::{
    radio::message,
    radio_configuration::RadioConfiguration,
    radio_control::{ControlMessage, process_control},
};

const VERSION: u8 = 1;
const TYPE: &str = "radio";

#[derive(Deserialize)]
struct Envelope {
    version: u8,
    #[serde(rename = "type")]
    message_type: String,
}
#[derive(Deserialize)]
#[serde(tag = "action")]
enum ClientMessage {
    SetRig {
        rig: u8,
    },
    SetModeAndFreq {
        mode: String,
        freq: f32,
    },
    HighlightSpot {
        dx_callsign: String,
        de_callsign: String,
        freq: u64,
        mode: String,
        udp_port: u16,
    },
    GetCapabilities,
    ListHamlibModels,
    ListSerialPorts,
    DescribeHamlibModel {
        model_id: String,
    },
    GetRadioConfiguration,
    SetRadioConfiguration {
        configuration: Box<RadioConfig>,
    },
    TestRadioConnection {
        config: Box<RadioConfig>,
    },
    RetryRadio,
}
pub(super) fn is_message(message: &str) -> bool {
    serde_json::from_str::<Envelope>(message)
        .is_ok_and(|value| value.version == VERSION && value.message_type == TYPE)
}
pub(super) async fn process_ws(
    message: String,
    radio: &RadioManager,
    service: &RadioConfiguration,
) -> Result<Option<Message>> {
    match serde_json::from_str(&message) {
        Ok(request) => process(request, radio, service).await,
        Err(_) => Ok(None),
    }
}

async fn process(
    request: ClientMessage,
    radio: &RadioManager,
    service: &RadioConfiguration,
) -> Result<Option<Message>> {
    let (event, data) = match request {
        ClientMessage::SetRig { rig } => {
            return control(ControlMessage::SetRig { rig }, radio).await;
        }
        ClientMessage::SetModeAndFreq { mode, freq } => {
            return control(ControlMessage::SetModeAndFreq { mode, freq }, radio).await;
        }
        ClientMessage::HighlightSpot {
            dx_callsign,
            de_callsign,
            freq,
            mode,
            udp_port,
        } => {
            return control(
                ControlMessage::HighlightSpot {
                    dx_callsign,
                    de_callsign,
                    freq,
                    mode,
                    udp_port,
                },
                radio,
            )
            .await;
        }
        ClientMessage::GetCapabilities => (
            "capabilities",
            serde_json::to_value(service.capabilities())?,
        ),
        ClientMessage::ListHamlibModels => (
            "hamlib_models",
            service
                .models()
                .map(|models| serde_json::json!({"models": models}))
                .unwrap_or_else(|error| serde_json::json!({"error": error})),
        ),
        ClientMessage::ListSerialPorts => (
            "serial_ports",
            service
                .serial_ports()
                .map(|ports| serde_json::json!({"ports": ports}))
                .unwrap_or_else(|error| serde_json::json!({"error": error})),
        ),
        ClientMessage::DescribeHamlibModel { model_id } => (
            "hamlib_model",
            match service.describe(&model_id) {
                Ok(descriptors) => {
                    serde_json::json!({"model_id": model_id, "descriptors": descriptors})
                }
                Err(error) => serde_json::json!({"model_id": model_id, "error": error}),
            },
        ),
        ClientMessage::GetRadioConfiguration => (
            "configuration",
            configuration_data(service.configuration(radio.snapshot().config)),
        ),
        ClientMessage::SetRadioConfiguration { configuration } => (
            "configuration_result",
            serde_json::to_value(service.set_configuration(*configuration).await)?,
        ),
        ClientMessage::TestRadioConnection { config } => (
            "radio_connection_result",
            serde_json::to_value(service.test_connection(*config).await)?,
        ),
        ClientMessage::RetryRadio => {
            radio.retry().await?;
            ("configuration_result", serde_json::json!({"ok": true}))
        }
    };
    Ok(Some(message(event, &data)?))
}
async fn control(message: ControlMessage, radio: &RadioManager) -> Result<Option<Message>> {
    process_control(message, radio).await?;
    Ok(None)
}
fn configuration_data(configuration: RadioConfig) -> serde_json::Value {
    serde_json::to_value(configuration).expect("radio configuration is serializable")
}

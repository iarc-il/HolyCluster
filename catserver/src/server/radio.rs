use anyhow::{Context, Result, bail};
use axum::extract::ws::Message;
use serde::{Deserialize, Serialize};
use tokio::net::UdpSocket;

use crate::{freq::Freq, radio_manager::RadioManager, rig::Mode};

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
pub(super) struct RadioInitMessage {
    pub(super) status: String,
    pub(super) catserver_version: String,
}

#[derive(Serialize)]
struct LegacyInitMessage {
    status: String,
    version: String,
}

#[derive(Serialize)]
struct CloseMessage {
    close: bool,
}

#[derive(Serialize)]
struct FocusMessage {
    focus: bool,
}

#[derive(Deserialize)]
struct Envelope {
    version: u8,
    #[serde(rename = "type")]
    message_type: String,
}

#[derive(Deserialize)]
struct SetModeAndFreq {
    mode: String,
    freq: f32,
}

#[derive(Deserialize)]
struct SetRig {
    rig: u8,
}

#[derive(Deserialize)]
struct HighlightSpot {
    dx_callsign: String,
    de_callsign: String,
    freq: u64,
    mode: String,
    udp_port: u16,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum LegacyClientMessage {
    SetRig(SetRig),
    SetModeAndFreq(SetModeAndFreq),
    HighlightSpot(HighlightSpot),
}

#[derive(Deserialize)]
#[serde(tag = "action")]
enum ClientMessage {
    SetRig(SetRig),
    SetModeAndFreq(SetModeAndFreq),
    HighlightSpot(HighlightSpot),
}

pub(super) fn status_message<T: Serialize>(data: &T) -> Result<Message> {
    message("status", data)
}

pub(super) fn focus_message() -> Result<Message> {
    message("focus", &FocusMessage { focus: true })
}
pub(super) fn close_message() -> Result<Message> {
    message("close", &CloseMessage { close: true })
}

pub(super) fn legacy_init_message() -> Result<Message> {
    Ok(Message::Text(
        serde_json::to_string(&LegacyInitMessage {
            status: "connected".into(),
            version: env!("VERSION").into(),
        })?
        .into(),
    ))
}

pub(super) fn legacy_status_message<T: Serialize>(data: &T) -> Result<Message> {
    Ok(Message::Text(serde_json::to_string(data)?.into()))
}

pub(super) fn legacy_focus_message() -> Result<Message> {
    Ok(Message::Text(
        serde_json::to_string(&FocusMessage { focus: true })?.into(),
    ))
}

pub(super) fn legacy_close_message() -> Result<Message> {
    Ok(Message::Text(
        serde_json::to_string(&CloseMessage { close: true })?.into(),
    ))
}

pub(super) fn is_message(message: &str) -> bool {
    serde_json::from_str::<Envelope>(message)
        .is_ok_and(|message| message.version == VERSION && message.message_type == TYPE)
}

pub(super) async fn process_legacy(message: String, radio: &RadioManager) -> Result<()> {
    let Ok(message) = serde_json::from_str::<LegacyClientMessage>(&message) else {
        tracing::error!("Failed to parse message: {message}");
        return Ok(());
    };
    process(
        match message {
            LegacyClientMessage::SetRig(message) => ClientMessage::SetRig(message),
            LegacyClientMessage::SetModeAndFreq(message) => ClientMessage::SetModeAndFreq(message),
            LegacyClientMessage::HighlightSpot(message) => ClientMessage::HighlightSpot(message),
        },
        radio,
    )
    .await
}

pub(super) async fn process_ws(message: String, radio: &RadioManager) -> Result<()> {
    let Ok(message) = serde_json::from_str::<ClientMessage>(&message) else {
        tracing::error!("Failed to parse radio message: {message}");
        return Ok(());
    };
    process(message, radio).await
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

async fn process(message: ClientMessage, radio: &RadioManager) -> Result<()> {
    match message {
        ClientMessage::SetRig(message) => {
            tracing::debug!("Setting rig to {}", message.rig);
            radio.set_rig(message.rig).await?;
        }
        ClientMessage::SetModeAndFreq(message) => {
            let mode = match (message.mode.as_str(), is_upper_sideband(message.freq)) {
                ("SSB", true) => Mode::USB,
                ("SSB", false) => Mode::LSB,
                ("DIGI" | "FT8" | "FT4", _) => Mode::Data,
                ("CW", _) => Mode::CW,
                (mode, is_upper) => bail!("Unknown mode: {mode}, is upper: {is_upper}"),
            };
            tracing::debug!("Setting mode to {mode:?}");
            let freq = Freq::from_f32_khz(message.freq);
            tracing::debug!("Setting freq to {freq:?}");
            radio.set_mode_and_frequency(mode, freq).await?;
        }
        ClientMessage::HighlightSpot(message) => send_spot(message).await?,
    }
    Ok(())
}

async fn send_spot(message: HighlightSpot) -> Result<()> {
    let mode = match message.mode.as_str() {
        "FT8" => crate::reporting::Mode::FT8,
        "FT4" => crate::reporting::Mode::FT4,
        "CW" => crate::reporting::Mode::CW,
        "SSB" => crate::reporting::Mode::Ssb,
        "DIGI" => crate::reporting::Mode::Rtty,
        mode => {
            tracing::error!("Unknown mode: {mode}");
            return Ok(());
        }
    };
    let packet = crate::reporting::build_status_packet(
        &message.dx_callsign,
        &message.de_callsign,
        message.freq,
        mode,
        "0",
        "",
        "",
    );
    let socket = UdpSocket::bind("127.0.0.1:0").await?;
    socket
        .send_to(&packet, format!("127.0.0.1:{}", message.udp_port))
        .await
        .with_context(|| format!("Failed to send UDP packet to port {}", message.udp_port))?;
    Ok(())
}

fn is_upper_sideband(freq: f32) -> bool {
    !(1800.0..=2000.0).contains(&freq)
        && !(3500.0..=4000.0).contains(&freq)
        && !(7000.0..=7300.0).contains(&freq)
}

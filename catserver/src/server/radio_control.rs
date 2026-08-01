use anyhow::{Context, Result, bail};
use serde::Deserialize;
use tokio::net::UdpSocket;

use crate::{freq::Freq, radio_manager::RadioManager, rig::Mode};

#[derive(Deserialize)]
#[serde(tag = "action")]
pub(super) enum ControlMessage {
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
}

pub(super) async fn process_control(message: ControlMessage, radio: &RadioManager) -> Result<()> {
    match message {
        ControlMessage::SetRig { rig } => radio.set_rig(rig).await?,
        ControlMessage::SetModeAndFreq { mode, freq } => {
            let mode = match (mode.as_str(), is_upper_sideband(freq)) {
                ("SSB", true) => Mode::USB,
                ("SSB", false) => Mode::LSB,
                ("DIGI" | "FT8" | "FT4", _) => Mode::Data,
                ("CW", _) => Mode::CW,
                (mode, upper) => bail!("Unknown mode: {mode}, is upper: {upper}"),
            };
            radio
                .set_mode_and_frequency(mode, Freq::from_f32_khz(freq))
                .await?;
        }
        ControlMessage::HighlightSpot {
            dx_callsign,
            de_callsign,
            freq,
            mode,
            udp_port,
        } => send_spot(&dx_callsign, &de_callsign, freq, &mode, udp_port).await?,
    }
    Ok(())
}

async fn send_spot(dx: &str, de: &str, freq: u64, mode: &str, port: u16) -> Result<()> {
    let mode = match mode {
        "FT8" => crate::reporting::Mode::FT8,
        "FT4" => crate::reporting::Mode::FT4,
        "CW" => crate::reporting::Mode::CW,
        "SSB" => crate::reporting::Mode::Ssb,
        "DIGI" => crate::reporting::Mode::Digi,
        value => bail!("Unknown mode: {value}"),
    };
    let packet = crate::reporting::build_status_packet(dx, de, freq, mode, "", "");
    let socket = UdpSocket::bind("127.0.0.1:0").await?;
    socket
        .send_to(&packet, format!("127.0.0.1:{port}"))
        .await
        .with_context(|| format!("Failed to send UDP packet to port {port}"))?;
    Ok(())
}
fn is_upper_sideband(freq: f32) -> bool {
    !(1800.0..=2000.0).contains(&freq)
        && !(3500.0..=4000.0).contains(&freq)
        && !(7000.0..=7300.0).contains(&freq)
}

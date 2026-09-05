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
                ("RTTY", _) => Mode::Rtty,
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
        "RTTY" => crate::reporting::Mode::Rtty,
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

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::{
        freq::Freq,
        radio_config::{ActiveRadioBackend, RadioConfig},
        rig::{Radio, RadioInitError, Slot, Status},
    };

    struct RecordingRadio {
        modes: Arc<Mutex<Vec<&'static str>>>,
    }

    impl Radio for RecordingRadio {
        fn init(&mut self) -> Result<(), RadioInitError> {
            Ok(())
        }

        fn set_mode(&mut self, mode: crate::rig::Mode) {
            let name = match mode {
                crate::rig::Mode::USB => "USB",
                crate::rig::Mode::LSB => "LSB",
                crate::rig::Mode::Data => "Data",
                crate::rig::Mode::Rtty => "Rtty",
                crate::rig::Mode::CW => "CW",
            };
            self.modes.lock().unwrap().push(name);
        }

        fn set_rig(&mut self, _: u8) {}

        fn set_frequency(&mut self, _: Slot, _: Freq) {}

        fn get_status(&mut self) -> Status {
            Status {
                freq: 0,
                status: "connected".into(),
                mode: "SSB".into(),
                current_rig: 1,
            }
        }
    }

    #[tokio::test]
    async fn maps_supported_control_modes_and_rejects_unknown() {
        let modes = Arc::new(Mutex::new(Vec::new()));
        let radio =
            RadioManager::new(RadioConfig::platform_default(), ActiveRadioBackend::Dummy).unwrap();
        let recording = Arc::clone(&modes);
        radio
            .replace(
                RadioConfig::platform_default(),
                ActiveRadioBackend::Dummy,
                move || {
                    Box::new(RecordingRadio {
                        modes: Arc::clone(&recording),
                    })
                },
            )
            .await
            .unwrap();

        for mode in ["FT8", "FT4", "DIGI", "RTTY"] {
            process_control(
                ControlMessage::SetModeAndFreq {
                    mode: mode.into(),
                    freq: 14_074.0,
                },
                &radio,
            )
            .await
            .unwrap();
        }
        assert_eq!(*modes.lock().unwrap(), ["Data", "Data", "Data", "Rtty"]);

        let error = process_control(
            ControlMessage::SetModeAndFreq {
                mode: "UNKNOWN".into(),
                freq: 14_074.0,
            },
            &radio,
        )
        .await
        .expect_err("unknown control mode was accepted");
        assert!(error.to_string().contains("Unknown mode: UNKNOWN"));
        radio.shutdown().await.unwrap();
    }
}

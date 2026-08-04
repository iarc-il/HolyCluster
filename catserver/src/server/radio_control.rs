use anyhow::{Context, Result, bail};
use serde::Deserialize;
use tokio::{
    io::AsyncWriteExt,
    net::{TcpStream, UdpSocket},
    time::{Duration, timeout},
};

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
    NotifyAcLog {
        dx_callsign: String,
        freq: u64,
        band: String,
        mode: String,
        host: String,
        port: u16,
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
        ControlMessage::NotifyAcLog {
            dx_callsign,
            freq,
            band,
            mode,
            host,
            port,
        } => {
            if send_aclog_spot(&dx_callsign, freq, &band, &mode, &host, port)
                .await
                .is_err()
            {
                tracing::warn!("Unable to notify AC Log");
            }
        }
    }
    Ok(())
}

const ACLOG_TIMEOUT: Duration = Duration::from_secs(2);
const ACLOG_COMMAND_DELAY: Duration = Duration::from_millis(5);

async fn send_aclog_spot(
    callsign: &str,
    freq: u64,
    band: &str,
    mode: &str,
    host: &str,
    port: u16,
) -> Result<()> {
    let address = match host {
        "127.0.0.1" => format!("127.0.0.1:{port}"),
        "::1" => format!("[::1]:{port}"),
        "localhost" => format!("127.0.0.1:{port}"),
        _ => bail!("AC Log host is not a loopback address"),
    };
    let frequency = format!("{:.6}", freq as f64 / 1_000_000.0);
    let mut stream = timeout(ACLOG_TIMEOUT, TcpStream::connect(address))
        .await
        .context("Timed out connecting to AC Log")??;
    write_aclog_command(
        &mut stream,
        "<CMD><IGNORERIGPOLLS><VALUE>TRUE</VALUE></CMD>\r\n",
    )
    .await?;
    let result = async {
        for command in [
            format!(
                "<CMD><CHANGEBM><BAND>{}</BAND><MODE>{}</MODE></CMD>\r\n",
                xml_escape(band),
                xml_escape(mode),
            ),
            format!(
                "<CMD><UPDATE><CONTROL>TXTENTRYFREQUENCY</CONTROL><VALUE>{frequency}</VALUE></CMD>\r\n"
            ),
            format!(
                "<CMD><UPDATE><CONTROL>TXTENTRYCALL</CONTROL><VALUE>{}</VALUE></CMD>\r\n",
                xml_escape(callsign),
            ),
            "<CMD><ACTION><VALUE>CALLTAB</VALUE></CMD>\r\n".to_owned(),
        ] {
            tokio::time::sleep(ACLOG_COMMAND_DELAY).await;
            write_aclog_command(&mut stream, &command).await?;
        }
        Ok(())
    }
    .await;
    tokio::time::sleep(ACLOG_COMMAND_DELAY).await;
    let reset_result = write_aclog_command(
        &mut stream,
        "<CMD><IGNORERIGPOLLS><VALUE>FALSE</VALUE></CMD>\r\n",
    )
    .await;
    result.and(reset_result)
}

async fn write_aclog_command(stream: &mut TcpStream, command: &str) -> Result<()> {
    timeout(ACLOG_TIMEOUT, stream.write_all(command.as_bytes()))
        .await
        .context("Timed out writing to AC Log")??;
    Ok(())
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('\"', "&quot;")
        .replace('\'', "&apos;")
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

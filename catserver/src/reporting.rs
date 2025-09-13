use std::{error::Error, net::UdpSocket};

const MAGIC: u32 = 0xadbccbda;
const SCHEMA: u32 = 2;
// This is the status packet type
const PACKET_TYPE: u32 = 1;
const WSJTX_ID: &[u8; 6] = b"WSJT-X";

#[derive(Debug)]
pub enum Mode {
    FT8,
    FT4,
    CW,
    Ssb,
    Rtty,
}

impl Mode {
    fn as_bytes(&self) -> &[u8] {
        match self {
            Mode::FT8 => b"FT8",
            Mode::FT4 => b"FT4",
            Mode::CW => b"CW",
            Mode::Ssb => b"SSB",
            Mode::Rtty => b"RTTY",
        }
    }
}

pub fn build_status_packet(
    dx_callsign: &str,
    de_callsign: &str,
    freq: u64,
    mode: Mode,
    report: &str,
    dx_grid: &str,
    de_grid: &str,
) -> Vec<u8> {
    let mut packet = vec![];

    fn write_str(packet: &mut Vec<u8>, data: &[u8]) {
        packet.extend(&(data.len() as u32).to_be_bytes());
        packet.extend(data);
    }

    // Header
    packet.extend(&MAGIC.to_be_bytes());
    packet.extend(&SCHEMA.to_be_bytes());
    packet.extend(&PACKET_TYPE.to_be_bytes());

    write_str(&mut packet, WSJTX_ID);
    packet.extend(&freq.to_be_bytes());
    // Mode
    write_str(&mut packet, mode.as_bytes());
    write_str(&mut packet, dx_callsign.as_bytes());
    // Report
    write_str(&mut packet, report.as_bytes());
    // tx mode
    write_str(&mut packet, mode.as_bytes());

    // tx enabled, transmitting, decoding
    packet.extend(b"\x00\x00\x00");

    // rx_df
    packet.extend(&0u32.to_be_bytes());
    // tx_df
    packet.extend(&0u32.to_be_bytes());
    write_str(&mut packet, de_callsign.as_bytes());
    write_str(&mut packet, de_grid.as_bytes());
    write_str(&mut packet, dx_grid.as_bytes());
    packet.extend(b"\x00");

    // Submode and fast mode?
    packet.extend(b"\xFF\xFF\xFF\xFF\x00\x00\xFF\xFF\xFF\xFF\xFF\xFF\xFF\xFF");
    // Special op mode?
    write_str(&mut packet, b"Default");
    // Unknown
    packet.extend(b"\xFF\xFF\xFF\xFF");

    packet
}

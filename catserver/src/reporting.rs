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
    Digi,
}

impl Mode {
    fn as_bytes(&self) -> &[u8] {
        match self {
            Mode::FT8 => b"FT8",
            Mode::FT4 => b"FT4",
            Mode::CW => b"CW",
            Mode::Ssb => b"SSB",
            Mode::Rtty | Mode::Digi => b"RTTY",
        }
    }

    fn report(&self) -> &[u8] {
        match self {
            Mode::FT8 | Mode::FT4 => b"+00",
            Mode::CW | Mode::Rtty => b"599",
            Mode::Ssb => b"59",
            Mode::Digi => b"",
        }
    }
}

pub fn build_status_packet(
    dx_callsign: &str,
    de_callsign: &str,
    freq: u64,
    mode: Mode,
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
    write_str(&mut packet, mode.report());
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

#[cfg(test)]
mod tests {
    use super::{build_status_packet, Mode};

    fn read_str(packet: &[u8], offset: &mut usize) -> Vec<u8> {
        let length = u32::from_be_bytes(packet[*offset..*offset + 4].try_into().unwrap()) as usize;
        *offset += 4;
        let value = packet[*offset..*offset + length].to_vec();
        *offset += length;
        value
    }

    fn packet_report(mode: Mode) -> Vec<u8> {
        let packet = build_status_packet("DX1ABC", "DE1ABC", 14_074_000, mode, "", "");
        let mut offset = 12;
        read_str(&packet, &mut offset);
        offset += 8;
        read_str(&packet, &mut offset);
        read_str(&packet, &mut offset);
        read_str(&packet, &mut offset)
    }

    #[test]
    fn sets_report_for_each_mode() {
        assert_eq!(packet_report(Mode::FT8), b"+00");
        assert_eq!(packet_report(Mode::FT4), b"+00");
        assert_eq!(packet_report(Mode::CW), b"599");
        assert_eq!(packet_report(Mode::Rtty), b"599");
        assert_eq!(packet_report(Mode::Ssb), b"59");
        assert_eq!(packet_report(Mode::Digi), b"");
    }
}

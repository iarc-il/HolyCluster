use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;

use crate::freq::Freq;
use crate::rig::{Mode, Radio, Slot, Status};

pub struct RigctldRadio {
    stream: Option<TcpStream>,
    host: String,
    port: u16,
    current_rig: u8,
    reconnect_counter: u8,
}

impl RigctldRadio {
    pub fn new(host: String, port: u16) -> Self {
        Self {
            stream: None,
            host,
            port,
            current_rig: 1,
            reconnect_counter: 0,
        }
    }

    fn send_command(&mut self, cmd: &str) -> Option<String> {
        let result = if let Some(stream) = &mut self.stream {
            if let Err(err) = writeln!(stream, "{}", cmd) {
                tracing::error!("Failed to send command: {}", err);
                None
            } else {
                let mut reader = BufReader::new(stream.try_clone().ok()?);
                let mut response = String::new();
                if let Err(err) = reader.read_line(&mut response) {
                    tracing::error!("Failed to read response: {}", err);
                    None
                } else {
                    Some(response.trim().to_string())
                }
            }
        } else {
            None
        };

        match result {
            Some(response) => {
                self.reconnect_counter = 0;
                Some(response)
            }
            None => {
                self.reconnect_counter += 1;
                if self.reconnect_counter >= 5 {
                    self.reconnect_counter = 0;
                    self.init();
                }
                None
            }
        }
    }

    fn connect(&mut self) -> bool {
        match TcpStream::connect(format!("{}:{}", self.host, self.port)) {
            Ok(stream) => {
                self.stream = Some(stream);
                true
            }
            Err(e) => {
                tracing::error!("Failed to connect to rigctld: {}", e);
                false
            }
        }
    }
}

impl Radio for RigctldRadio {
    fn init(&mut self) {
        if self.connect() {
            tracing::info!("Connected to rigctld at {}:{}", self.host, self.port);
        }
    }

    fn get_name(&self) -> &str {
        "rigctld"
    }

    fn set_mode(&mut self, mode: Mode) {
        let mode_str = match mode {
            Mode::USB => "USB",
            Mode::LSB => "LSB",
            Mode::Data => "PKTUSB",
            Mode::CW => "CW",
        };

        let cmd = format!("M {} 0", mode_str);
        if self.send_command(&cmd).is_none() {
            tracing::error!("Failed to set mode");
        }
    }

    fn set_rig(&mut self, rig: u8) {
        if rig != 1 && rig != 2 {
            panic!("Invalid rig: {rig}");
        }
        self.current_rig = rig;
    }

    fn set_frequency(&mut self, slot: Slot, freq: Freq) {
        let cmd = match slot {
            Slot::A => format!("F {}", freq.as_u32_hz()),
            Slot::B => format!("I {}", freq.as_u32_hz()),
        };

        if self.send_command(&cmd).is_none() {
            tracing::error!("Failed to set frequency");
        }
    }

    fn get_status(&mut self) -> Status {
        let mut status = Status {
            freq: 0,
            status: "disconnected".into(),
            mode: "unknown".into(),
            current_rig: self.current_rig,
        };

        if let Some(response) = self.send_command("f") {
            if let Ok(freq) = response.parse::<u32>() {
                status.freq = freq;
                status.status = "connected".into();
            }
        } else {
            return status;
        }

        if let Some(response) = self.send_command("m") {
            let parts: Vec<&str> = response.split_whitespace().collect();
            if !parts.is_empty() {
                status.mode = match parts[0] {
                    "USB" | "LSB" => "SSB",
                    "PKTUSB" | "PKTLSB" | "RTTY" | "RTTYR" => "DIGI",
                    "CW" | "CWR" => "CW",
                    "AM" => "AM",
                    "FM" | "WFM" => "FM",
                    _ => "unknown",
                }
                .into();
            }
        }

        status
    }
}

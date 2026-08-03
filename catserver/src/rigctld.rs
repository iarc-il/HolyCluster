use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;

use crate::freq::Freq;
use crate::rig::{Mode, Radio, RadioInitError, Slot, Status};

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
            if let Err(err) = writeln!(stream, "{cmd}") {
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
                    let _ = self.init();
                }
                None
            }
        }
    }

    fn connect(&mut self) -> Result<(), RadioInitError> {
        match TcpStream::connect(format!("{}:{}", self.host, self.port)) {
            Ok(stream) => {
                self.stream = Some(stream);
                Ok(())
            }
            Err(error) => {
                tracing::error!("Failed to connect to rigctld: {error}");
                Err(RadioInitError::Io {
                    backend: "rigctld",
                    kind: error.kind(),
                })
            }
        }
    }
}

impl Radio for RigctldRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        self.connect()?;
        tracing::info!("Connected to rigctld at {}:{}", self.host, self.port);
        Ok(())
    }

    fn set_mode(&mut self, mode: Mode) {
        let mode_str = match mode {
            Mode::USB => "USB",
            Mode::LSB => "LSB",
            Mode::Data => "PKTUSB",
            Mode::CW => "CW",
        };

        let cmd = format!("M {mode_str} 0");
        if self.send_command(&cmd).is_none() {
            tracing::error!("Failed to set mode");
        }
    }

    fn set_rig(&mut self, rig: u8) {
        if rig != 1 && rig != 2 {
            tracing::error!(rig, "Ignoring invalid rigctld rig");
            return;
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
        let mut status = Status::disconnected(self.current_rig);

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

#[cfg(test)]
mod tests {
    use std::{
        io::{BufRead, BufReader, Write},
        net::{TcpListener, TcpStream},
        thread,
    };

    use super::RigctldRadio;
    use crate::{
        freq::Freq,
        rig::{Mode, Radio, Slot},
    };

    fn command(reader: &mut BufReader<TcpStream>) -> String {
        let mut value = String::new();
        reader.read_line(&mut value).unwrap();
        value.trim().into()
    }

    #[test]
    fn sends_rigctld_commands_and_parses_status_over_loopback() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut commands = Vec::new();

            commands.push(command(&mut reader));
            writeln!(stream, "RPRT 0").unwrap();
            commands.push(command(&mut reader));
            writeln!(stream, "RPRT 0").unwrap();
            commands.push(command(&mut reader));
            writeln!(stream, "7074000").unwrap();
            commands.push(command(&mut reader));
            writeln!(stream, "PKTUSB 0").unwrap();

            commands
        });

        let mut radio = RigctldRadio::new("127.0.0.1".into(), port);
        radio.init().unwrap();
        radio.set_rig(2);
        radio.set_mode(Mode::Data);
        radio.set_frequency(Slot::A, Freq::from_u32_hz(7_074_000));

        assert_eq!(
            radio.get_status(),
            crate::rig::Status {
                freq: 7_074_000,
                status: "connected".into(),
                mode: "DIGI".into(),
                current_rig: 2,
            }
        );
        assert_eq!(
            server.join().unwrap(),
            ["M PKTUSB 0", "F 7074000", "f", "m"]
        );
    }

    #[test]
    fn reconnects_to_loopback_rigctld_after_five_failed_commands() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream);
            assert_eq!(command(&mut reader), "f");
            drop(reader);

            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            assert_eq!(command(&mut reader), "f");
            writeln!(stream, "14074000").unwrap();
            assert_eq!(command(&mut reader), "m");
            writeln!(stream, "USB 0").unwrap();
        });

        let mut radio = RigctldRadio::new("127.0.0.1".into(), port);
        radio.init().unwrap();
        for _ in 0..5 {
            assert_eq!(radio.get_status().status, "disconnected");
        }

        assert_eq!(
            radio.get_status(),
            crate::rig::Status {
                freq: 14_074_000,
                status: "connected".into(),
                mode: "SSB".into(),
                current_rig: 1,
            }
        );
        server.join().unwrap();
    }
}

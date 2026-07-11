use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;

use crate::rotator::{Rotator, RotatorStatus};

pub struct RotctldRotator {
    stream: Option<TcpStream>,
    host: String,
    port: u16,
    name: String,
    reconnect_counter: u8,
}

impl RotctldRotator {
    pub fn new(host: String, port: u16) -> Self {
        Self {
            stream: None,
            host,
            port,
            name: "rotctld".into(),
            reconnect_counter: 0,
        }
    }

    fn send_command(&mut self, cmd: &str) -> Option<String> {
        let result = if let Some(stream) = &mut self.stream {
            if let Err(err) = writeln!(stream, "{cmd}") {
                tracing::error!("Failed to send rotctld command: {}", err);
                None
            } else {
                let mut reader = BufReader::new(stream.try_clone().ok()?);
                let mut response = String::new();
                if let Err(err) = reader.read_line(&mut response) {
                    tracing::error!("Failed to read rotctld response: {}", err);
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

    fn send_command_two_lines(&mut self, cmd: &str) -> Option<(String, String)> {
        let result = if let Some(stream) = &mut self.stream {
            if let Err(err) = writeln!(stream, "{cmd}") {
                tracing::error!("Failed to send rotctld command: {}", err);
                None
            } else {
                let mut reader = BufReader::new(stream.try_clone().ok()?);
                let mut line1 = String::new();
                let mut line2 = String::new();
                if let Err(err) = reader.read_line(&mut line1) {
                    tracing::error!("Failed to read rotctld response: {}", err);
                    None
                } else if let Err(err) = reader.read_line(&mut line2) {
                    tracing::error!("Failed to read rotctld second line: {}", err);
                    None
                } else {
                    Some((line1.trim().to_string(), line2.trim().to_string()))
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
                tracing::error!("Failed to connect to rotctld: {}", e);
                false
            }
        }
    }
}

impl Rotator for RotctldRotator {
    fn init(&mut self) {
        if self.connect() {
            tracing::info!("Connected to rotctld at {}:{}", self.host, self.port);
        }
    }

    fn get_name(&self) -> &str {
        &self.name
    }

    fn set_azimuth(&mut self, azimuth: f64) {
        let cmd = format!("P {azimuth} 0.0");
        if self.send_command(&cmd).is_none() {
            tracing::error!("Failed to set azimuth");
        }
    }

    fn get_status(&mut self) -> RotatorStatus {
        let mut status = RotatorStatus {
            azimuth: 0.0,
            status: "disconnected".into(),
            name: self.name.clone(),
        };

        if let Some((azimuth, _)) = self.send_command_two_lines("p") {
            if let Ok(az) = azimuth.parse::<f64>() {
                status.azimuth = az;
                status.status = "connected".into();
            }
        }

        status
    }

    fn is_available(&self) -> bool {
        self.stream.is_some()
    }
}

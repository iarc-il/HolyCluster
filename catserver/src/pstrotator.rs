use std::net::UdpSocket;
use std::time::Duration;

use crate::rotator::{Rotator, RotatorError, RotatorStatus};

pub struct PstRotator {
    socket: Option<UdpSocket>,
    addr: String,
    azimuth: f64,
}

impl PstRotator {
    pub fn new() -> Self {
        Self {
            socket: None,
            addr: "127.0.0.1:12040".into(),
            azimuth: 0.0,
        }
    }

    fn send(&self, command: &str) -> Result<(), RotatorError> {
        let socket = self
            .socket
            .as_ref()
            .ok_or_else(|| RotatorError::new("command", "not connected"))?;
        socket
            .send_to(command.as_bytes(), &self.addr)
            .map(|_| ())
            .map_err(|error| RotatorError::new("send", error.to_string()))
    }

    fn query_status(&mut self) -> Result<String, RotatorError> {
        self.send("STATUS")?;
        let socket = self
            .socket
            .as_ref()
            .ok_or_else(|| RotatorError::new("status", "not connected"))?;
        let mut buffer = [0u8; 1024];
        let (length, _) = socket
            .recv_from(&mut buffer)
            .map_err(|error| RotatorError::new("receive status", error.to_string()))?;
        Ok(String::from_utf8_lossy(&buffer[..length]).trim().to_owned())
    }
}

impl Rotator for PstRotator {
    fn init(&mut self) -> Result<(), RotatorError> {
        let socket = UdpSocket::bind("127.0.0.1:0")
            .map_err(|error| RotatorError::new("bind", error.to_string()))?;
        socket
            .set_read_timeout(Some(Duration::from_millis(500)))
            .map_err(|error| RotatorError::new("set read timeout", error.to_string()))?;
        socket
            .set_write_timeout(Some(Duration::from_millis(500)))
            .map_err(|error| RotatorError::new("set write timeout", error.to_string()))?;
        self.socket = Some(socket);
        Ok(())
    }

    fn name(&self) -> &str {
        "pstRotator"
    }

    fn set_azimuth(&mut self, azimuth: f64) -> Result<(), RotatorError> {
        self.send(&format!("AZ={azimuth}"))?;
        self.azimuth = azimuth;
        Ok(())
    }

    fn status(&mut self) -> Result<RotatorStatus, RotatorError> {
        let response = self.query_status()?;
        for part in response.split(',') {
            if let Some(azimuth) = part.trim().strip_prefix("AZ=") {
                self.azimuth = azimuth
                    .parse()
                    .map_err(|error: std::num::ParseFloatError| {
                        RotatorError::new("parse azimuth", error.to_string())
                    })?;
            }
        }
        Ok(RotatorStatus {
            azimuth: self.azimuth,
            status: "connected".into(),
            name: self.name().into(),
        })
    }
}

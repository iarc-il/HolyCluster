use std::net::UdpSocket;
use std::time::Duration;

use crate::rotator::{Rotator, RotatorStatus};

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

    fn send(&mut self, cmd: &str) {
        let Some(socket) = &self.socket else {
            return;
        };
        if let Err(e) = socket.send_to(cmd.as_bytes(), &self.addr) {
            tracing::error!("Failed to send to pstRotator: {}", e);
        }
    }

    fn query_status(&mut self) -> Option<String> {
        let socket = self.socket.as_ref()?;
        self.send("STATUS");
        let mut buf = [0u8; 1024];
        socket.set_read_timeout(Some(Duration::from_millis(500))).ok()?;
        match socket.recv_from(&mut buf) {
            Ok((len, _)) => {
                let response = String::from_utf8_lossy(&buf[..len]).trim().to_string();
                Some(response)
            }
            Err(e) => {
                tracing::error!("Failed to read from pstRotator: {}", e);
                None
            }
        }
    }

    fn connect(&mut self) -> bool {
        match UdpSocket::bind("127.0.0.1:0") {
            Ok(socket) => {
                self.socket = Some(socket);
                true
            }
            Err(e) => {
                tracing::error!("Failed to bind UDP socket for pstRotator: {}", e);
                false
            }
        }
    }
}

impl Rotator for PstRotator {
    fn init(&mut self) {
        if self.connect() {
            tracing::info!("Connected to pstRotator at {}", self.addr);
        }
    }

    fn get_name(&self) -> &str {
        "pstRotator"
    }

    fn set_azimuth(&mut self, azimuth: f64) {
        self.azimuth = azimuth;
        self.send(&format!("AZ={azimuth}"));
    }

    fn set_elevation(&mut self, elevation: f64) {
        self.send(&format!("EL={elevation}"));
    }

    fn get_status(&mut self) -> RotatorStatus {
        let mut status = RotatorStatus {
            azimuth: self.azimuth,
            elevation: 0.0,
            status: "disconnected".into(),
            name: self.get_name().into(),
        };

        if self.socket.is_some() {
            status.status = "connected".into();
            if let Some(response) = self.query_status() {
                for part in response.split(',') {
                    let part = part.trim();
                    if let Some(az) = part.strip_prefix("AZ=") {
                        if let Ok(v) = az.parse::<f64>() {
                            status.azimuth = v;
                            self.azimuth = v;
                        }
                    } else if let Some(el) = part.strip_prefix("EL=") {
                        if let Ok(v) = el.parse::<f64>() {
                            status.elevation = v;
                        }
                    }
                }
            }
        }

        status
    }

    fn is_available(&self) -> bool {
        self.socket.is_some()
    }
}
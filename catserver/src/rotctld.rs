use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::time::Duration;

use crate::rotator::{Rotator, RotatorError, RotatorStatus};

pub struct RotctldRotator {
    stream: Option<TcpStream>,
    host: String,
    port: u16,
}

impl RotctldRotator {
    pub fn new(host: String, port: u16) -> Self {
        Self {
            stream: None,
            host,
            port,
        }
    }

    fn send_command(&mut self, command: &str) -> Result<String, RotatorError> {
        let stream = self
            .stream
            .as_mut()
            .ok_or_else(|| RotatorError::new("command", "not connected"))?;
        writeln!(stream, "{command}")
            .map_err(|error| RotatorError::new("write", error.to_string()))?;
        let mut reader = BufReader::new(
            stream
                .try_clone()
                .map_err(|error| RotatorError::new("clone stream", error.to_string()))?,
        );
        let mut response = String::new();
        reader
            .read_line(&mut response)
            .map_err(|error| RotatorError::new("read", error.to_string()))?;
        Ok(response.trim().to_owned())
    }

    fn send_command_two_lines(&mut self, command: &str) -> Result<(String, String), RotatorError> {
        let stream = self
            .stream
            .as_mut()
            .ok_or_else(|| RotatorError::new("command", "not connected"))?;
        writeln!(stream, "{command}")
            .map_err(|error| RotatorError::new("write", error.to_string()))?;
        let mut reader = BufReader::new(
            stream
                .try_clone()
                .map_err(|error| RotatorError::new("clone stream", error.to_string()))?,
        );
        let mut first = String::new();
        let mut second = String::new();
        reader
            .read_line(&mut first)
            .map_err(|error| RotatorError::new("read azimuth", error.to_string()))?;
        reader
            .read_line(&mut second)
            .map_err(|error| RotatorError::new("read elevation", error.to_string()))?;
        Ok((first.trim().to_owned(), second.trim().to_owned()))
    }
}

impl Rotator for RotctldRotator {
    fn init(&mut self) -> Result<(), RotatorError> {
        let stream = TcpStream::connect(format!("{}:{}", self.host, self.port))
            .map_err(|error| RotatorError::new("connect", error.to_string()))?;
        stream
            .set_read_timeout(Some(Duration::from_millis(500)))
            .map_err(|error| RotatorError::new("set read timeout", error.to_string()))?;
        stream
            .set_write_timeout(Some(Duration::from_millis(500)))
            .map_err(|error| RotatorError::new("set write timeout", error.to_string()))?;
        self.stream = Some(stream);
        Ok(())
    }

    fn name(&self) -> &str {
        "rotctld"
    }

    fn set_azimuth(&mut self, azimuth: f64) -> Result<(), RotatorError> {
        self.send_command(&format!("P {azimuth} 0.0")).map(drop)
    }

    fn status(&mut self) -> Result<RotatorStatus, RotatorError> {
        let (azimuth, _) = self.send_command_two_lines("p")?;
        let azimuth = azimuth
            .parse::<f64>()
            .map_err(|error| RotatorError::new("parse azimuth", error.to_string()))?;
        Ok(RotatorStatus {
            azimuth,
            status: "connected".into(),
            name: self.name().into(),
        })
    }
}

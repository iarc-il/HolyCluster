use std::{fmt, io};

use serde::Serialize;

use crate::freq::Freq;

#[allow(clippy::upper_case_acronyms)]
#[derive(Debug, Clone, Copy)]
pub enum Mode {
    USB,
    LSB,
    Data,
    Rtty,
    CW,
}

#[derive(Debug, Clone, Eq, PartialEq)]
#[repr(u8)]
pub enum Slot {
    A = 1,
    #[allow(dead_code)]
    B = 2,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Status {
    pub freq: u32,
    pub status: String,
    pub mode: String,
    pub current_rig: u8,
}

impl Status {
    pub fn disconnected(current_rig: u8) -> Self {
        Self {
            freq: 0,
            status: "disconnected".into(),
            mode: "unknown".into(),
            current_rig,
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum RadioInitError {
    Hamlib {
        rig: u8,
        error: String,
        details: Option<String>,
    },
    Io {
        backend: &'static str,
        kind: io::ErrorKind,
    },
}

impl fmt::Display for RadioInitError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Hamlib { rig, error, .. } => {
                write!(formatter, "Hamlib rig {rig} initialization failed: {error}")
            }
            Self::Io { backend, kind } => {
                write!(formatter, "{backend} initialization failed: {kind}")
            }
        }
    }
}

impl std::error::Error for RadioInitError {}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct RadioOperationError {
    pub rig: u8,
    pub operation: &'static str,
    pub message: String,
    pub details: Option<String>,
}

impl RadioOperationError {
    pub fn new(rig: u8, operation: &'static str, message: impl Into<String>) -> Self {
        Self {
            rig,
            operation,
            message: message.into(),
            details: None,
        }
    }

    pub fn with_rig(mut self, rig: u8) -> Self {
        self.rig = rig;
        self
    }
}

impl fmt::Display for RadioOperationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "radio {} failed for rig {}: {}",
            self.operation, self.rig, self.message
        )
    }
}

impl std::error::Error for RadioOperationError {}

pub trait Radio {
    fn init(&mut self) -> Result<(), RadioInitError>;
    fn set_mode(&mut self, mode: Mode) -> Result<(), RadioOperationError>;
    fn set_rig(&mut self, rig: u8) -> Result<(), RadioOperationError>;
    fn set_frequency(&mut self, slot: Slot, freq: Freq) -> Result<(), RadioOperationError>;
    fn get_status(&mut self) -> Status;
    fn initialization_errors(&self) -> [Option<RadioInitError>; 2] {
        [None, None]
    }
}

pub struct UnavailableRadio {
    backend: &'static str,
}

impl UnavailableRadio {
    pub fn new(backend: &'static str) -> Self {
        Self { backend }
    }
}

impl Radio for UnavailableRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        Err(RadioInitError::Io {
            backend: self.backend,
            kind: io::ErrorKind::NotFound,
        })
    }
    fn set_mode(&mut self, _: Mode) -> Result<(), RadioOperationError> {
        Err(RadioOperationError::new(1, "set mode", "radio unavailable"))
    }
    fn set_rig(&mut self, rig: u8) -> Result<(), RadioOperationError> {
        Err(RadioOperationError::new(
            rig,
            "select rig",
            "radio unavailable",
        ))
    }
    fn set_frequency(&mut self, _: Slot, _: Freq) -> Result<(), RadioOperationError> {
        Err(RadioOperationError::new(
            1,
            "set frequency",
            "radio unavailable",
        ))
    }
    fn get_status(&mut self) -> Status {
        Status::disconnected(1)
    }
}

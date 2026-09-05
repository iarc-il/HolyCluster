use std::{fmt, io};

use serde::Serialize;

use crate::freq::Freq;

#[allow(clippy::upper_case_acronyms)]
#[derive(Debug, Clone)]
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

pub trait Radio {
    fn init(&mut self) -> Result<(), RadioInitError>;
    fn set_mode(&mut self, mode: Mode);
    fn set_rig(&mut self, rig: u8);
    fn set_frequency(&mut self, slot: Slot, freq: Freq);
    fn get_status(&mut self) -> Status;
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
    fn set_mode(&mut self, _: Mode) {}
    fn set_rig(&mut self, _: u8) {}
    fn set_frequency(&mut self, _: Slot, _: Freq) {}
    fn get_status(&mut self) -> Status {
        Status::disconnected(1)
    }
}

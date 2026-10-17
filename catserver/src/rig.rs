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
    Backend {
        backend: &'static str,
        message: String,
    },
    Com {
        message: String,
        context: Box<RadioBackendContext>,
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
            Self::Backend { backend, message } => {
                write!(formatter, "{backend} initialization failed: {message}")
            }
            Self::Com { message, .. } => {
                write!(formatter, "omnirig initialization failed: {message}")
            }
        }
    }
}

impl std::error::Error for RadioInitError {}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
pub struct RadioInitializationContext {
    pub outcome: &'static str,
    pub error: Option<String>,
    pub details: Option<String>,
    pub backend_call: Option<Box<RadioBackendContext>>,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
pub struct RadioDisconnectContext {
    pub origin: &'static str,
    pub error: String,
    pub backend_call: Option<Box<RadioBackendContext>>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct RadioActorContext {
    pub application_connection_state: &'static str,
    pub configuration_present: bool,
    pub selected_backend: &'static str,
    pub model_id: Option<String>,
    pub backend_object_present: bool,
    pub initialization_failed: bool,
    pub initialization: Option<RadioInitializationContext>,
    pub disconnect: Option<RadioDisconnectContext>,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
pub struct RadioBackendContext {
    pub backend: &'static str,
    pub operation: &'static str,
    pub target: Option<&'static str>,
    pub resolved_mode: Option<&'static str>,
    pub handle_present: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hresult: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exception_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exception_wcode: Option<u16>,
}

impl RadioBackendContext {
    pub fn new(backend: &'static str, operation: &'static str, handle_present: bool) -> Self {
        Self {
            backend,
            operation,
            target: None,
            resolved_mode: None,
            handle_present,
            hresult: None,
            exception_code: None,
            exception_wcode: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum RadioOperationErrorKind {
    Failure,
    UnsupportedMode,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct RadioOperationError {
    pub rig: u8,
    pub operation: &'static str,
    pub kind: RadioOperationErrorKind,
    pub message: String,
    pub details: Option<String>,
    pub actor_context: Option<Box<RadioActorContext>>,
    pub backend_context: Option<Box<RadioBackendContext>>,
}

impl RadioOperationError {
    pub fn new(rig: u8, operation: &'static str, message: impl Into<String>) -> Self {
        Self {
            rig,
            operation,
            kind: RadioOperationErrorKind::Failure,
            message: message.into(),
            details: None,
            actor_context: None,
            backend_context: None,
        }
    }

    pub fn unsupported_mode(rig: u8, message: impl Into<String>) -> Self {
        Self {
            kind: RadioOperationErrorKind::UnsupportedMode,
            ..Self::new(rig, "set mode", message)
        }
    }

    pub fn with_backend_context(mut self, context: RadioBackendContext) -> Self {
        self.backend_context = Some(Box::new(context));
        self
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
    fn validate_mode(&self, _: Mode) -> Result<(), RadioOperationError> {
        Ok(())
    }
    /// Tune a spot with frequency on A. Hamlib selects A before both writes.
    /// The default preserves the existing backend-specific mode targeting
    /// and mode/frequency sequence.
    fn tune_spot(&mut self, mode: Mode, frequency: Freq) -> Result<(), RadioOperationError> {
        self.set_mode(mode)?;
        self.set_frequency(Slot::A, frequency)
    }
    fn set_mode(&mut self, mode: Mode) -> Result<(), RadioOperationError>;
    fn set_frequency(&mut self, slot: Slot, freq: Freq) -> Result<(), RadioOperationError>;
    fn get_status(&mut self) -> Result<Status, RadioOperationError>;
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
    fn set_frequency(&mut self, _: Slot, _: Freq) -> Result<(), RadioOperationError> {
        Err(RadioOperationError::new(
            1,
            "set frequency",
            "radio unavailable",
        ))
    }
    fn get_status(&mut self) -> Result<Status, RadioOperationError> {
        Err(RadioOperationError::new(
            1,
            "read status",
            "radio unavailable",
        ))
    }
}

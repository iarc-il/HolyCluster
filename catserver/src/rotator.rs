use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RotatorStatus {
    pub azimuth: f64,
    pub status: String,
    pub name: String,
}

impl RotatorStatus {
    pub fn disconnected(name: impl Into<String>) -> Self {
        Self {
            azimuth: 0.0,
            status: "disconnected".into(),
            name: name.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum RotatorErrorKind {
    Failure,
    Unsupported,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
pub struct RotatorError {
    pub operation: &'static str,
    pub message: String,
    pub native_error: Option<serde_json::Value>,
    pub execution_state: Option<serde_json::Value>,
    #[serde(skip)]
    kind: RotatorErrorKind,
}

impl RotatorError {
    pub fn new(operation: &'static str, message: impl Into<String>) -> Self {
        Self {
            operation,
            message: message.into(),
            native_error: None,
            execution_state: None,
            kind: RotatorErrorKind::Failure,
        }
    }

    pub(crate) fn unsupported(mut self) -> Self {
        self.kind = RotatorErrorKind::Unsupported;
        self
    }

    pub(crate) fn is_unsupported(&self) -> bool {
        self.kind == RotatorErrorKind::Unsupported
    }
}

impl std::fmt::Display for RotatorError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "rotator {} failed: {}",
            self.operation, self.message
        )
    }
}

impl std::error::Error for RotatorError {}

pub trait Rotator {
    fn init(&mut self) -> Result<(), RotatorError>;
    fn name(&self) -> &str;
    fn set_azimuth(&mut self, azimuth: f64) -> Result<(), RotatorError>;
    fn stop(&mut self) -> Result<(), RotatorError>;
    fn status(&mut self) -> Result<RotatorStatus, RotatorError>;
}

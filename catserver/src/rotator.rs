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

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct RotatorError {
    operation: &'static str,
    message: String,
}

impl RotatorError {
    pub fn new(operation: &'static str, message: impl Into<String>) -> Self {
        Self {
            operation,
            message: message.into(),
        }
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
    fn status(&mut self) -> Result<RotatorStatus, RotatorError>;
}

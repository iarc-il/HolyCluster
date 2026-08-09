use thiserror::Error;

use crate::RigModelId;

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum ConfigTokenError {
    #[error("configuration token must not be empty")]
    Empty,
    #[error("configuration token must not contain NUL")]
    EmbeddedNul,
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum ConfigValueError {
    #[error("configuration value for {token} must be {expected}")]
    Invalid {
        token: String,
        expected: &'static str,
    },
    #[error("configuration value for {token} is outside its allowed range")]
    OutOfRange { token: String },
    #[error("configuration value for {token} is not on its allowed step")]
    InvalidStep { token: String },
    #[error("configuration value for {token} is not an allowed option")]
    InvalidOption { token: String },
    #[error("configuration value for {token} contains NUL")]
    EmbeddedNul { token: String },
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum ConfigurationError {
    #[error(transparent)]
    Value(#[from] ConfigValueError),
    #[error("configuration token {token} is unavailable on model {model}")]
    UnknownToken { model: RigModelId, token: String },
    #[error(transparent)]
    Hamlib(#[from] HamlibError),
}

#[derive(Clone, Debug, Error, PartialEq)]
pub enum RigControlError {
    #[error(transparent)]
    Hamlib(#[from] HamlibError),
    #[error("frequency must be finite and non-negative")]
    InvalidFrequency,
    #[error("Hamlib returned unknown VFO {0}")]
    UnknownVfo(u32),
    #[error("Hamlib returned unknown mode {0}")]
    UnknownMode(u64),
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum HamlibError {
    #[error("invalid rotator position")]
    InvalidPosition,
    #[error("invalid configuration")]
    InvalidConfiguration,
    #[error("Hamlib {operation} failed with code {code}: {message}")]
    Call {
        operation: &'static str,
        code: i32,
        message: String,
    },
    #[error("Hamlib {operation} returned a null handle for model {model}")]
    NullHandle {
        operation: &'static str,
        model: RigModelId,
    },
    #[error("Hamlib {operation} returned null error text for code {code}")]
    NullErrorText { operation: &'static str, code: i32 },
    #[error("Hamlib {operation} returned invalid UTF-8 error text for code {code}")]
    InvalidErrorText { operation: &'static str, code: i32 },
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum CatalogError {
    #[error(transparent)]
    Hamlib(#[from] HamlibError),
    #[error("Hamlib returned null {field} for {subject}")]
    NullMetadata {
        subject: &'static str,
        field: &'static str,
    },
    #[error("Hamlib returned invalid UTF-8 for {field} on {subject}")]
    InvalidUtf8 {
        subject: &'static str,
        field: &'static str,
    },
    #[error("Hamlib returned invalid status {status} for model {model}")]
    InvalidStatus { model: RigModelId, status: u32 },
    #[error("Hamlib callback panicked while enumerating {operation}")]
    CallbackPanic { operation: &'static str },
    #[error("Hamlib returned malformed {reason} for token {token}")]
    MalformedDescriptor { token: String, reason: &'static str },
    #[error("Hamlib returned duplicate configuration token {token}")]
    DuplicateToken { token: String },
    #[error("unknown Hamlib model {model}")]
    UnknownModel { model: RigModelId },
}

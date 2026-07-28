use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};

use crate::ConfigTokenError;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct RigModelId(u32);

impl RigModelId {
    pub const DUMMY: Self = Self(1);

    pub const fn new(value: u32) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u32 {
        self.0
    }
}

impl fmt::Display for RigModelId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub struct RigModel {
    pub(crate) id: RigModelId,
    pub(crate) manufacturer: String,
    pub(crate) model: String,
    pub(crate) version: String,
    pub(crate) status: RigModelStatus,
}

impl RigModel {
    pub const fn id(&self) -> RigModelId {
        self.id
    }

    pub fn manufacturer(&self) -> &str {
        &self.manufacturer
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    pub fn version(&self) -> &str {
        &self.version
    }

    pub const fn status(&self) -> RigModelStatus {
        self.status
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RigModelStatus {
    Alpha,
    Untested,
    Beta,
    Stable,
    Buggy,
}

#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct ConfigToken(String);

impl ConfigToken {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for ConfigToken {
    type Error = ConfigTokenError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.is_empty() {
            return Err(ConfigTokenError::Empty);
        }
        if value.contains('\0') {
            return Err(ConfigTokenError::EmbeddedNul);
        }
        Ok(Self(value))
    }
}

impl FromStr for ConfigToken {
    type Err = ConfigTokenError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::try_from(value.to_owned())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum ConfigDescriptor {
    Text {
        token: ConfigToken,
        label: String,
        tooltip: String,
        default: String,
    },
    Path {
        token: ConfigToken,
        label: String,
        tooltip: String,
        default: String,
    },
    Integer {
        token: ConfigToken,
        label: String,
        tooltip: String,
        default: i64,
        minimum: i64,
        maximum: i64,
        step: i64,
    },
    Numeric {
        token: ConfigToken,
        label: String,
        tooltip: String,
        default: f64,
        minimum: f64,
        maximum: f64,
        step: f64,
    },
    Boolean {
        token: ConfigToken,
        label: String,
        tooltip: String,
        default: bool,
    },
    Combo {
        token: ConfigToken,
        label: String,
        tooltip: String,
        default: String,
        options: Vec<String>,
    },
}

impl ConfigDescriptor {
    pub fn token(&self) -> &ConfigToken {
        match self {
            Self::Text { token, .. }
            | Self::Path { token, .. }
            | Self::Integer { token, .. }
            | Self::Numeric { token, .. }
            | Self::Boolean { token, .. }
            | Self::Combo { token, .. } => token,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "value")]
pub enum ConfigValue {
    Text(String),
    Integer(i64),
    Numeric(f64),
    Boolean(bool),
    Combo(String),
}

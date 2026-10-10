use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
pub struct HamlibDeviceConfig {
    pub model_id: String,
    pub token_values: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum HamlibDeviceConfigError {
    InvalidModelId(String),
    InvalidToken(String),
}

impl std::fmt::Display for HamlibDeviceConfigError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidModelId(model) => write!(formatter, "invalid model id {model}"),
            Self::InvalidToken(token) => write!(formatter, "invalid configuration token {token}"),
        }
    }
}

impl std::error::Error for HamlibDeviceConfigError {}

impl HamlibDeviceConfig {
    pub(crate) fn validate(&self) -> Result<(), HamlibDeviceConfigError> {
        match self.model_id.parse::<u32>() {
            Ok(model_id) if model_id > 0 => {}
            _ => {
                return Err(HamlibDeviceConfigError::InvalidModelId(
                    self.model_id.clone(),
                ));
            }
        }
        for token in self.token_values.keys() {
            if !is_descriptor_token(token) {
                return Err(HamlibDeviceConfigError::InvalidToken(token.clone()));
            }
        }
        Ok(())
    }
}

fn is_descriptor_token(token: &str) -> bool {
    let mut characters = token.chars();
    matches!(characters.next(), Some(character) if character.is_ascii_alphabetic())
        && characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

use std::{future::Future, pin::Pin, sync::Arc};

use serde::{Deserialize, Serialize};

use crate::{
    args::{DEFAULT_RIGCTLD_HOST, DEFAULT_RIGCTLD_PORT},
    radio_config::{HamlibConfig, HamlibRigConfig, RadioBackendKind, RadioConfig},
    radio_factory,
    radio_manager::RadioManager,
};

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(super) struct Capabilities {
    pub(super) radio_configuration: bool,
    pub(super) backends: Vec<&'static str>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(super) struct HamlibModel {
    pub(super) id: String,
    pub(super) manufacturer: String,
    pub(super) model: String,
    pub(super) version: String,
    pub(super) status: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(super) struct FieldError {
    pub(super) field: String,
    pub(super) message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) token: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(super) struct ConfigurationResult {
    pub(super) ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) error: Option<FieldError>,
}

pub(super) trait RadioConfigurationService: Send + Sync {
    fn capabilities(&self) -> Capabilities;
    fn models(&self) -> Result<Vec<HamlibModel>, FieldError>;
    fn describe(&self, model_id: &str) -> Result<Vec<serde_json::Value>, FieldError>;
    fn configuration(&self, current: RadioConfig) -> RadioConfig;
    fn set_configuration(&self, configuration: RadioConfig) -> ConfigurationFuture<'_>;
}

pub(super) type RadioConfiguration = Arc<dyn RadioConfigurationService>;
pub(super) type ConfigurationFuture<'a> =
    Pin<Box<dyn Future<Output = ConfigurationResult> + Send + 'a>>;

pub(super) struct ProductionRadioConfiguration {
    radio: RadioManager,
}

impl ProductionRadioConfiguration {
    #[cfg(test)]
    pub(super) fn new(radio: RadioManager) -> Self {
        Self { radio }
    }
}

impl RadioConfigurationService for ProductionRadioConfiguration {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            radio_configuration: true,
            backends: vec!["omnirig", "rigctld", "hamlib"],
        }
    }

    fn models(&self) -> Result<Vec<HamlibModel>, FieldError> {
        let catalog = hamlib::Catalog::load().map_err(catalog_error)?;
        Ok(catalog
            .models()
            .iter()
            .map(|model| HamlibModel {
                id: model.id().to_string(),
                manufacturer: model.manufacturer().into(),
                model: model.model().into(),
                version: model.version().into(),
                status: format!("{:?}", model.status()).to_lowercase(),
            })
            .collect())
    }

    fn describe(&self, model_id: &str) -> Result<Vec<serde_json::Value>, FieldError> {
        let id = model_id.parse().map_err(|_| invalid_model(model_id))?;
        let catalog = hamlib::Catalog::load().map_err(catalog_error)?;
        catalog
            .describe_model(hamlib::RigModelId::new(id))
            .map_err(catalog_error)?
            .into_iter()
            .map(|descriptor| serde_json::to_value(descriptor).map_err(catalog_error))
            .collect()
    }

    fn configuration(&self, current: RadioConfig) -> RadioConfig {
        current
    }

    fn set_configuration(&self, configuration: RadioConfig) -> ConfigurationFuture<'_> {
        Box::pin(async move {
            if let Err(error) = validate_configuration(&configuration) {
                return ConfigurationResult {
                    ok: false,
                    error: Some(error),
                };
            }
            let selected = configuration.effective_backend(false);
            let factory = radio_factory::factory(
                configuration.clone(),
                selected.clone(),
                (DEFAULT_RIGCTLD_HOST.into(), DEFAULT_RIGCTLD_PORT),
            );
            match self
                .radio
                .replace_and_persist(configuration, selected, move || factory())
                .await
            {
                Ok(()) => ConfigurationResult {
                    ok: true,
                    error: None,
                },
                Err(error) => ConfigurationResult {
                    ok: false,
                    error: Some(manager_error(error)),
                },
            }
        })
    }
}

fn validate_configuration(configuration: &RadioConfig) -> Result<(), FieldError> {
    configuration.validate().map_err(|error| FieldError {
        field: config_field(&error),
        message: error.to_string(),
        token: config_token(&error),
    })?;
    if let Some(hamlib) = &configuration.hamlib {
        validate_hamlib(hamlib)?;
    }
    Ok(())
}

fn validate_hamlib(configuration: &HamlibConfig) -> Result<(), FieldError> {
    validate_rig("hamlib.rig1", &configuration.rig1)?;
    if let Some(rig2) = &configuration.rig2 {
        validate_rig("hamlib.rig2", rig2)?;
    }
    Ok(())
}

fn validate_rig(field: &str, configuration: &HamlibRigConfig) -> Result<(), FieldError> {
    let model = configuration.model_id.parse().map_err(|_| FieldError {
        field: format!("{field}.model_id"),
        message: format!("invalid Hamlib model: {}", configuration.model_id),
        token: None,
    })?;
    let descriptors = hamlib::Catalog::load()
        .map_err(|error| model_error(field, error))?
        .describe_model(hamlib::RigModelId::new(model))
        .map_err(|error| model_error(field, error))?;
    for (token, value) in &configuration.token_values {
        let descriptor = descriptors
            .iter()
            .find(|descriptor| descriptor.token().as_str() == token)
            .ok_or_else(|| FieldError {
                field: format!("{field}.token_values"),
                message: format!("unknown Hamlib configuration token: {token}"),
                token: Some(token.clone()),
            })?;
        descriptor.parse_value(value).map_err(|error| FieldError {
            field: format!("{field}.token_values"),
            message: error.to_string(),
            token: Some(token.clone()),
        })?;
    }
    Ok(())
}

pub(super) fn production(radio: RadioManager) -> RadioConfiguration {
    Arc::new(ProductionRadioConfiguration { radio })
}

pub(super) fn parse_backend(value: &str) -> Result<RadioBackendKind, FieldError> {
    match value {
        "omnirig" => Ok(RadioBackendKind::Omnirig),
        "rigctld" => Ok(RadioBackendKind::Rigctld),
        "hamlib" => Ok(RadioBackendKind::Hamlib),
        _ => Err(FieldError {
            field: "backend".into(),
            message: format!("unknown backend: {value}"),
            token: None,
        }),
    }
}

#[derive(Deserialize)]
pub(super) struct ConfigurationInput {
    pub(super) backend: String,
    #[serde(default)]
    pub(super) hamlib: Option<crate::radio_config::HamlibConfig>,
}

impl ConfigurationInput {
    pub(super) fn into_config(self) -> Result<RadioConfig, FieldError> {
        Ok(RadioConfig {
            backend: parse_backend(&self.backend)?,
            hamlib: self.hamlib,
        })
    }
}

fn invalid_model(model_id: &str) -> FieldError {
    FieldError {
        field: "model_id".into(),
        message: format!("invalid Hamlib model: {model_id}"),
        token: None,
    }
}

fn catalog_error(error: impl std::fmt::Display) -> FieldError {
    FieldError {
        field: "model_id".into(),
        message: error.to_string(),
        token: None,
    }
}

fn model_error(field: &str, error: impl std::fmt::Display) -> FieldError {
    FieldError {
        field: format!("{field}.model_id"),
        message: error.to_string(),
        token: None,
    }
}

fn manager_error(error: crate::radio_manager::RadioManagerError) -> FieldError {
    FieldError {
        field: "backend".into(),
        message: error.to_string(),
        token: None,
    }
}

fn config_field(error: &crate::radio_config::RadioConfigError) -> String {
    use crate::radio_config::RadioConfigError::*;
    match error {
        InvalidModelId(_) => "hamlib.rig1.model_id",
        InvalidToken(_) => "hamlib.rig1.token_values",
        _ => "backend",
    }
    .into()
}

fn config_token(error: &crate::radio_config::RadioConfigError) -> Option<String> {
    match error {
        crate::radio_config::RadioConfigError::InvalidToken(token) => Some(token.clone()),
        _ => None,
    }
}

use serde::Serialize;

use crate::{
    rotator_config::RotatorConfig,
    rotator_factory,
    rotator_manager::{RotatorManager, RotatorManagerError},
};

use super::radio_configuration::{
    ConfigurationFailure, ConfigurationResult, FieldError, HamlibModel,
};

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(super) struct RotatorModel {
    #[serde(flatten)]
    model: HamlibModel,
    enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    disabled_reason: Option<String>,
}

#[derive(Clone)]
pub(super) struct RotatorConfiguration {
    manager: RotatorManager,
}

impl RotatorConfiguration {
    pub(super) fn new(manager: RotatorManager) -> Self {
        Self { manager }
    }

    pub(super) fn models(&self) -> Result<Vec<RotatorModel>, FieldError> {
        let catalog = hamlib::RotatorCatalog::load().map_err(catalog_error)?;
        Ok(catalog
            .models()
            .iter()
            .map(|model| {
                let disabled_reason = match (model.can_get_position(), model.can_set_position()) {
                    (true, true) => None,
                    (false, false) => Some("model cannot get or set position".into()),
                    (false, true) => Some("model cannot get position".into()),
                    (true, false) => Some("model cannot set position".into()),
                };
                RotatorModel {
                    model: HamlibModel {
                        id: model.id().to_string(),
                        manufacturer: model.manufacturer().into(),
                        model: model.model().into(),
                        version: model.version().into(),
                        status: format!("{:?}", model.status()).to_lowercase(),
                        port_type: model.port_type(),
                    },
                    enabled: disabled_reason.is_none(),
                    disabled_reason,
                }
            })
            .collect())
    }

    pub(super) fn describe(&self, model_id: &str) -> Result<Vec<serde_json::Value>, FieldError> {
        let id = model_id
            .parse::<hamlib::RotatorModelId>()
            .map_err(|_| invalid_model(model_id))?;
        let catalog = hamlib::RotatorCatalog::load().map_err(catalog_error)?;
        catalog
            .describe_model(id)
            .map_err(catalog_error)?
            .into_iter()
            .map(|descriptor| serde_json::to_value(descriptor).map_err(catalog_error))
            .collect()
    }

    pub(super) fn configuration(&self) -> RotatorConfig {
        self.manager.snapshot().config
    }

    pub(super) async fn apply(&self, config: RotatorConfig) -> ConfigurationResult {
        if let Err(error) = config.validate() {
            return invalid_configuration(error);
        }
        let Some((selected, factory)) = rotator_factory::factory(&config) else {
            return match self.manager.clear(true).await {
                Ok(()) => ConfigurationResult::success(),
                Err(error) => manager_failure(error),
            };
        };
        match self
            .manager
            .replace_and_persist(config, selected, move || factory())
            .await
        {
            Ok(()) => ConfigurationResult::success(),
            Err(error) => manager_failure(error),
        }
    }

    pub(super) async fn test(&self, config: RotatorConfig) -> ConfigurationResult {
        if let Err(error) = config.validate() {
            return invalid_configuration(error);
        }
        let Some((_, factory)) = rotator_factory::factory(&config) else {
            return ConfigurationResult::success();
        };
        match self.manager.test_connection(move || factory()).await {
            Ok(()) => ConfigurationResult::success(),
            Err(error) => manager_failure(error),
        }
    }

    pub(super) async fn retry(&self) -> Result<(), RotatorManagerError> {
        self.manager.retry().await
    }
}

fn invalid_configuration(error: impl std::fmt::Display) -> ConfigurationResult {
    ConfigurationResult::failure(
        ConfigurationFailure::InvalidConfig,
        vec![FieldError {
            field: "configuration".into(),
            message: error.to_string(),
            token: None,
            details: None,
        }],
    )
}

fn manager_failure(error: RotatorManagerError) -> ConfigurationResult {
    let failure = match error {
        RotatorManagerError::InvalidConfig(_) | RotatorManagerError::InvalidAzimuth => {
            ConfigurationFailure::InvalidConfig
        }
        RotatorManagerError::Operation(_)
        | RotatorManagerError::WorkerStopped
        | RotatorManagerError::WorkerStart(_) => ConfigurationFailure::Connection,
    };
    ConfigurationResult::failure(
        failure,
        vec![FieldError {
            field: "connection".into(),
            message: error.to_string(),
            token: None,
            details: None,
        }],
    )
}

fn invalid_model(model: &str) -> FieldError {
    FieldError {
        field: "model_id".into(),
        message: format!("invalid Hamlib rotator model: {model}"),
        token: None,
        details: None,
    }
}

fn catalog_error(error: impl std::fmt::Display) -> FieldError {
    FieldError {
        field: "model_id".into(),
        message: error.to_string(),
        token: None,
        details: None,
    }
}

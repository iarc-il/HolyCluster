use std::{collections::BTreeMap, sync::Arc};

use super::{
    radio_actions::{process_legacy, process_ws},
    radio_configuration::{
        Capabilities, ConfigurationResult, FieldError, HamlibModel, ProductionRadioConfiguration,
        RadioConfiguration, RadioConfigurationService,
    },
};
use crate::{
    radio_config::{HamlibConfig, HamlibRigConfig, RadioBackendKind, RadioConfig},
    radio_manager::RadioManager,
};

struct Service;
impl RadioConfigurationService for Service {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            radio_configuration: true,
            backends: vec!["hamlib"],
        }
    }
    fn models(&self) -> Result<Vec<HamlibModel>, FieldError> {
        Ok(vec![HamlibModel {
            id: "1".into(),
            manufacturer: "Hamlib".into(),
            model: "Dummy".into(),
            version: "1".into(),
            status: "stable".into(),
        }])
    }
    fn describe(&self, _: &str) -> Result<Vec<serde_json::Value>, FieldError> {
        Ok(vec![serde_json::json!({"token": "path"})])
    }
    fn configuration(&self, current: RadioConfig) -> RadioConfig {
        current
    }
    fn set_configuration(&self, _: RadioConfig) -> ConfigurationResult {
        ConfigurationResult {
            ok: true,
            error: None,
        }
    }
}
fn radio() -> RadioManager {
    let config = RadioConfig::platform_default();
    RadioManager::new(config.clone(), config.effective_backend(false)).unwrap()
}

#[tokio::test]
async fn unified_and_legacy_actions_return_equivalent_data() {
    let radio = radio();
    let service: RadioConfiguration = Arc::new(Service);
    let unified = process_ws(
        r#"{"version":1,"type":"radio","action":"ListHamlibModels"}"#.into(),
        &radio,
        &service,
    )
    .await
    .unwrap()
    .unwrap()
    .into_text()
    .unwrap();
    let legacy = process_legacy(r#"{"type":"ListHamlibModels"}"#.into(), &radio, &service)
        .await
        .unwrap()
        .unwrap()
        .into_text()
        .unwrap();
    let mut unified: serde_json::Value = serde_json::from_str(&unified).unwrap();
    let legacy: serde_json::Value = serde_json::from_str(&legacy).unwrap();
    unified.as_object_mut().unwrap().remove("version");
    unified.as_object_mut().unwrap().remove("type");
    assert_eq!(unified, legacy);
}
#[tokio::test]
async fn invalid_configuration_returns_a_field_error() {
    let radio = radio();
    let service: RadioConfiguration = Arc::new(Service);
    let response = process_ws(r#"{"version":1,"type":"radio","action":"SetRadioConfiguration","configuration":{"backend":"missing"}}"#.into(), &radio, &service).await.unwrap().unwrap().into_text().unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&response).unwrap()["error"]["field"],
        "backend"
    );
}

#[test]
fn production_configuration_rejects_unknown_descriptor_tokens() {
    let result = ProductionRadioConfiguration.set_configuration(RadioConfig {
        backend: RadioBackendKind::Hamlib,
        hamlib: Some(HamlibConfig {
            rig1: HamlibRigConfig {
                model_id: "1".into(),
                token_values: BTreeMap::from([("unknown_token".into(), "value".into())]),
            },
            rig2: None,
        }),
    });
    assert_eq!(
        result.error.expect("field error").token,
        Some("unknown_token".into())
    );
}

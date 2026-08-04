use std::{collections::BTreeMap, sync::Arc};

use super::{
    radio_actions::process_ws,
    radio_configuration::{
        Capabilities, ConfigurationInput, ConfigurationResult, FieldError, HamlibModel,
        ProductionRadioConfiguration, RadioConfiguration, RadioConfigurationService,
    },
};
use crate::{
    radio_config::{HamlibRigConfig, RadioConfig, RadioRigConfig},
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
    fn set_configuration(
        &self,
        _: RadioConfig,
    ) -> super::radio_configuration::ConfigurationFuture<'_> {
        Box::pin(async {
            ConfigurationResult {
                ok: true,
                error: None,
            }
        })
    }
}
fn radio() -> RadioManager {
    let config = RadioConfig::platform_default();
    RadioManager::new(config.clone(), config.effective_backend(false)).unwrap()
}

#[tokio::test]
async fn unified_actions_return_typed_data() {
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
    let unified: serde_json::Value = serde_json::from_str(&unified).unwrap();
    assert_eq!(unified["type"], "radio");
    assert_eq!(unified["event"], "hamlib_models");
    assert_eq!(unified["models"][0]["id"], "1");
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
fn configuration_input_migrates_the_legacy_hamlib_shape() {
    let input: ConfigurationInput = serde_json::from_str(
        r#"{"backend":"hamlib","hamlib":{"rig1":{"model_id":"1","token_values":{}}}}"#,
    )
    .unwrap();

    assert_eq!(
        input.into_config().unwrap(),
        RadioConfig {
            rig1: RadioRigConfig::hamlib(HamlibRigConfig {
                model_id: "1".into(),
                token_values: BTreeMap::new(),
            }),
            rig2: None,
        }
    );
}

#[test]
fn configuration_input_defaults_rigctld_endpoint_fields() {
    let input: ConfigurationInput =
        serde_json::from_str(r#"{"rig1":{"backend":"rigctld","rigctld":{}}}"#).unwrap();

    let config = input.into_config().unwrap();
    let rigctld = config.rig1.rigctld.unwrap();
    assert_eq!(rigctld.host, "127.0.0.1");
    assert_eq!(rigctld.port, 4532);
}

#[tokio::test]
async fn production_configuration_rejects_unknown_descriptor_tokens() {
    let result = ProductionRadioConfiguration::new(radio())
        .set_configuration(RadioConfig {
            rig1: RadioRigConfig::hamlib(HamlibRigConfig {
                model_id: "1".into(),
                token_values: BTreeMap::from([("unknown_token".into(), "value".into())]),
            }),
            rig2: None,
        })
        .await;
    assert_eq!(
        result.error.expect("field error").token,
        Some("unknown_token".into())
    );
}

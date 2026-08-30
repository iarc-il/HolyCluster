use std::{collections::BTreeMap, sync::Arc};

use super::{
    radio_actions::process_ws,
    radio_configuration::{
        Capabilities, ConfigurationFailure, ConfigurationResult, FieldError, HamlibModel,
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
            port_type: hamlib::RigPortType::None,
        }])
    }
    fn serial_ports(&self) -> Result<Vec<String>, FieldError> {
        Ok(vec!["/dev/ttyUSB0".into()])
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
                failure: None,
                errors: Vec::new(),
            }
        })
    }
    fn test_connection(
        &self,
        _: RadioConfig,
    ) -> super::radio_configuration::ConfigurationFuture<'_> {
        Box::pin(async {
            ConfigurationResult {
                ok: true,
                failure: None,
                errors: Vec::new(),
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
async fn lists_serial_ports() {
    let radio = radio();
    let service: RadioConfiguration = Arc::new(Service);
    let response = process_ws(
        r#"{"version":1,"type":"radio","action":"ListSerialPorts"}"#.into(),
        &radio,
        &service,
    )
    .await
    .unwrap()
    .unwrap()
    .into_text()
    .unwrap();
    let response: serde_json::Value = serde_json::from_str(&response).unwrap();
    assert_eq!(response["type"], "radio");
    assert_eq!(response["event"], "serial_ports");
    assert_eq!(response["ports"][0], "/dev/ttyUSB0");
}
#[tokio::test]
async fn accepts_enum_configuration() {
    let radio = radio();
    let service: RadioConfiguration = Arc::new(Service);
    let response = process_ws(r#"{"version":1,"type":"radio","action":"SetRadioConfiguration","configuration":{"rig1":{"backend":"hamlib","hamlib":{"model_id":"1","token_values":{}}}}}"#.into(), &radio, &service).await.unwrap().unwrap().into_text().unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&response).unwrap()["ok"],
        true
    );
}

#[tokio::test]
async fn tests_radio_connection() {
    let radio = radio();
    let service: RadioConfiguration = Arc::new(Service);
    let response = process_ws(
        r#"{"version":1,"type":"radio","action":"TestRadioConnection","config":{"rig1":{"backend":"unconfigured"}}}"#.into(),
        &radio,
        &service,
    )
    .await
    .unwrap()
    .unwrap()
    .into_text()
    .unwrap();
    let response: serde_json::Value = serde_json::from_str(&response).unwrap();
    assert_eq!(response["type"], "radio");
    assert_eq!(response["event"], "radio_connection_result");
    assert_eq!(response["ok"], true);
}

#[tokio::test]
async fn production_configuration_rejects_unknown_descriptor_tokens() {
    let result = ProductionRadioConfiguration::new(radio())
        .set_configuration(RadioConfig {
            rig1: RadioRigConfig::Hamlib {
                hamlib: HamlibRigConfig {
                    model_id: "1".into(),
                    token_values: BTreeMap::from([("unknown_token".into(), "value".into())]),
                },
            },
            rig2: None,
        })
        .await;
    assert_eq!(result.errors[0].token, Some("unknown_token".into()));
}

#[tokio::test]
async fn production_configuration_returns_all_validation_errors() {
    let result = ProductionRadioConfiguration::new(radio())
        .set_configuration(RadioConfig {
            rig1: RadioRigConfig::Hamlib {
                hamlib: HamlibRigConfig {
                    model_id: "1".into(),
                    token_values: BTreeMap::from([("unknown_one".into(), "value".into())]),
                },
            },
            rig2: Some(RadioRigConfig::Hamlib {
                hamlib: HamlibRigConfig {
                    model_id: "1".into(),
                    token_values: BTreeMap::from([("unknown_two".into(), "value".into())]),
                },
            }),
        })
        .await;
    assert_eq!(result.errors.len(), 2);
    assert_eq!(result.failure, Some(ConfigurationFailure::InvalidConfig));
    assert_eq!(result.errors[0].token, Some("unknown_one".into()));
    assert_eq!(result.errors[1].token, Some("unknown_two".into()));
}

#[cfg(not(windows))]
#[tokio::test]
async fn production_configuration_returns_all_rigctld_errors() {
    let result = ProductionRadioConfiguration::new(radio())
        .set_configuration(RadioConfig {
            rig1: RadioRigConfig::Rigctld {
                rigctld: crate::radio_config::RigctldConfig {
                    host: " ".into(),
                    port: 0,
                },
            },
            rig2: None,
        })
        .await;
    let fields: Vec<_> = result
        .errors
        .iter()
        .map(|error| error.field.as_str())
        .collect();
    assert_eq!(fields, ["rig1.rigctld.host", "rig1.rigctld.port"]);
    assert_eq!(result.failure, Some(ConfigurationFailure::InvalidConfig));
}

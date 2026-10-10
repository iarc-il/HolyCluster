use std::{collections::BTreeMap, sync::Arc};

use super::{
    radio_actions::process_ws,
    radio_configuration::{
        Capabilities, ConfigurationFailure, ConfigurationResult, FieldError,
        ProductionRadioConfiguration, RadioConfiguration, RadioConfigurationService, RadioModel,
    },
};
use crate::{
    radio_config::{RadioConfig, RadioRigConfig},
    radio_manager::RadioManager,
    rig::Status,
};

struct Service;
impl RadioConfigurationService for Service {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            radio_configuration: true,
            radio_configuration_api: 2,
            rotator_configuration: true,
        }
    }
    fn models(&self) -> Result<Vec<RadioModel>, FieldError> {
        Ok(vec![RadioModel {
            id: "hamlib:1".into(),
            manufacturer: "Hamlib".into(),
            model: "Dummy".into(),
            version: "1".into(),
            status: "stable".into(),
            connection_kind: "none",
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
async fn list_radio_models_returns_typed_data() {
    let radio = radio();
    let service: RadioConfiguration = Arc::new(Service);
    let unified = process_ws(
        r#"{"version":1,"type":"radio","action":"ListRadioModels"}"#.into(),
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
    assert_eq!(unified["event"], "radio_models");
    assert_eq!(unified["models"][0]["id"], "hamlib:1");
    assert_eq!(unified["models"][0]["connection_kind"], "none");
}

#[tokio::test]
async fn describes_radio_model_with_typed_event() {
    let radio = radio();
    let service: RadioConfiguration = Arc::new(Service);
    let response = process_ws(
        r#"{"version":1,"type":"radio","action":"DescribeRadioModel","model_id":"hamlib:1"}"#
            .into(),
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
    assert_eq!(response["event"], "radio_model");
    assert_eq!(response["model_id"], "hamlib:1");
    assert_eq!(response["descriptors"][0]["token"], "path");
}

#[tokio::test]
async fn old_hamlib_model_actions_are_not_accepted() {
    let radio = radio();
    let service: RadioConfiguration = Arc::new(Service);
    assert!(
        process_ws(
            r#"{"version":1,"type":"radio","action":"ListHamlibModels"}"#.into(),
            &radio,
            &service,
        )
        .await
        .unwrap()
        .is_none()
    );
    assert!(
        process_ws(
            r#"{"version":1,"type":"radio","action":"DescribeHamlibModel","model_id":"1"}"#.into(),
            &radio,
            &service,
        )
        .await
        .unwrap()
        .is_none()
    );
}

#[tokio::test]
async fn set_rig_action_is_not_accepted() {
    let radio = radio();
    let service: RadioConfiguration = Arc::new(Service);
    assert!(
        process_ws(
            r#"{"version":1,"type":"radio","action":"SetRig","rig":2}"#.into(),
            &radio,
            &service,
        )
        .await
        .unwrap()
        .is_none()
    );
}

#[test]
fn status_message_omits_backend_and_current_rig() {
    let radio = radio();
    let message = super::radio::status_message(
        &Status {
            freq: 7_100_000,
            status: "connected".into(),
            mode: "CW".into(),
            current_rig: 1,
        },
        &radio,
    )
    .unwrap()
    .into_text()
    .unwrap();
    let message: serde_json::Value = serde_json::from_str(&message).unwrap();
    assert_eq!(message["event"], "status");
    assert!(message.get("backend").is_none());
    assert!(message.get("current_rig").is_none());
}

#[tokio::test]
async fn capabilities_advertise_radio_configuration_api_v2_without_backends() {
    let radio = radio();
    let service: RadioConfiguration = Arc::new(Service);
    let response = process_ws(
        r#"{"version":1,"type":"radio","action":"GetCapabilities"}"#.into(),
        &radio,
        &service,
    )
    .await
    .unwrap()
    .unwrap()
    .into_text()
    .unwrap();
    let response: serde_json::Value = serde_json::from_str(&response).unwrap();
    assert_eq!(response["event"], "capabilities");
    assert_eq!(response["radio_configuration_api"], 2);
    assert!(response.get("backends").is_none());
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
async fn production_catalog_uses_opaque_model_ids_and_generic_connection_kinds() {
    let models = ProductionRadioConfiguration::new(radio()).models().unwrap();
    let dummy = models
        .iter()
        .find(|model| model.id == "hamlib:1")
        .expect("Hamlib dummy model is present");
    assert_eq!(dummy.connection_kind, "none");
    assert!(
        models
            .iter()
            .all(|model| matches!(model.connection_kind, "serial" | "network" | "none"))
    );
    #[cfg(not(windows))]
    assert!(models.iter().all(|model| !model.id.starts_with("omnirig:")));
    #[cfg(windows)]
    {
        assert!(models.iter().any(|model| model.id == "omnirig:1"
            && model.model == "OmniRig Rig 1"
            && model.connection_kind == "none"));
        assert!(models.iter().any(|model| model.id == "omnirig:2"
            && model.model == "OmniRig Rig 2"
            && model.connection_kind == "none"));
    }
}

#[tokio::test]
async fn production_describes_hamlib_models_with_opaque_ids() {
    let descriptors = ProductionRadioConfiguration::new(radio())
        .describe("hamlib:1")
        .unwrap();
    assert!(!descriptors.is_empty());
    assert!(
        ProductionRadioConfiguration::new(radio())
            .describe("1")
            .is_err()
    );
}

#[cfg(windows)]
#[tokio::test]
async fn production_describes_omnirig_models_without_descriptors() {
    assert_eq!(
        ProductionRadioConfiguration::new(radio())
            .describe("omnirig:1")
            .unwrap(),
        Vec::<serde_json::Value>::new()
    );
}

#[cfg(not(windows))]
#[tokio::test]
async fn production_rejects_omnirig_descriptions_on_non_windows() {
    assert!(
        ProductionRadioConfiguration::new(radio())
            .describe("omnirig:1")
            .is_err()
    );
}

#[tokio::test]
async fn accepts_enum_configuration() {
    let radio = radio();
    let service: RadioConfiguration = Arc::new(Service);
    let response = process_ws(r#"{"version":1,"type":"radio","action":"SetRadioConfiguration","configuration":{"rig":{"model_id":"hamlib:1","token_values":{}}}}"#.into(), &radio, &service).await.unwrap().unwrap().into_text().unwrap();
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
        r#"{"version":1,"type":"radio","action":"TestRadioConnection","config":{"rig":null}}"#
            .into(),
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
            rig: Some(RadioRigConfig {
                model_id: "hamlib:1".into(),
                token_values: BTreeMap::from([("unknown_token".into(), "value".into())]),
            }),
        })
        .await;
    assert_eq!(result.errors[0].token, Some("unknown_token".into()));
}

#[tokio::test]
async fn production_configuration_reports_validation_errors() {
    let result = ProductionRadioConfiguration::new(radio())
        .set_configuration(RadioConfig {
            rig: Some(RadioRigConfig {
                model_id: "hamlib:1".into(),
                token_values: BTreeMap::from([("unknown_one".into(), "value".into())]),
            }),
        })
        .await;
    assert_eq!(result.errors.len(), 1);
    assert_eq!(result.failure, Some(ConfigurationFailure::InvalidConfig));
    assert_eq!(result.errors[0].token, Some("unknown_one".into()));
}

use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use super::{
    radio_actions::process_ws,
    radio_configuration::{
        Capabilities, ConfigurationFailure, ConfigurationResult, FieldError,
        ProductionRadioConfiguration, RadioConfiguration, RadioConfigurationService, RadioModel,
    },
};
use crate::{
    radio_config::{RadioConfig, RadioRigConfig},
    radio_config_store::{RadioConfigPlatform, RadioConfigStore},
    radio_manager::{ConnectionState, RadioManager},
    rig::Status,
};

struct TestDir(PathBuf);

impl TestDir {
    fn new() -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("catserver-radio-actions-{unique}"));
        fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn file(&self) -> PathBuf {
        self.0.join("radio.json")
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn radio_with_store(path: PathBuf, platform: RadioConfigPlatform) -> RadioManager {
    let config = RadioConfig::platform_default();
    RadioManager::new_with_store(
        config.clone(),
        config.effective_backend(false),
        RadioConfigStore::new(path, platform),
    )
    .unwrap()
}

fn production_service_with_store(
    path: PathBuf,
    platform: RadioConfigPlatform,
) -> (RadioManager, RadioConfiguration) {
    let radio = radio_with_store(path, platform);
    let service: RadioConfiguration = Arc::new(ProductionRadioConfiguration::new(radio.clone()));
    (radio, service)
}

struct Service;
impl RadioConfigurationService for Service {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            radio_configuration: true,
            radio_configuration_api: 2,
            rotator_configuration: true,
            omnirig_selection_migration_available: false,
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

    fn migrate_omnirig_selection(&self, _: u8) -> super::radio_configuration::MigrationFuture<'_> {
        Box::pin(async {
            super::radio_configuration::OmniRigSelectionMigrationResult {
                ok: true,
                migrated: false,
                effective_model_id: None,
                failure: None,
            }
        })
    }
}
fn radio() -> RadioManager {
    let directory = TestDir::new();
    radio_with_store(directory.file(), RadioConfigPlatform::current())
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
    assert_eq!(response["omnirig_selection_migration_available"], false);
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
async fn production_capabilities_expose_windows_only_omnirig_migration_availability() {
    let directory = TestDir::new();
    let (_, service) =
        production_service_with_store(directory.file(), RadioConfigPlatform::windows());
    assert!(service.capabilities().omnirig_selection_migration_available);

    let directory = TestDir::new();
    let (_, service) =
        production_service_with_store(directory.file(), RadioConfigPlatform::non_windows());
    assert!(!service.capabilities().omnirig_selection_migration_available);
}

#[tokio::test]
async fn development_schema_versions_do_not_block_omnirig_migration_availability() {
    for version in [1, 2] {
        let directory = TestDir::new();
        fs::write(
            directory.file(),
            format!(r#"{{"version":{version},"rig1":{{"backend":"omnirig"}}}}"#),
        )
        .unwrap();
        let (_, service) =
            production_service_with_store(directory.file(), RadioConfigPlatform::windows());
        assert!(service.capabilities().omnirig_selection_migration_available);
    }
}

#[tokio::test]
async fn existing_release_or_invalid_config_blocks_omnirig_migration_availability() {
    for config in [
        r#"{"version":3,"rig":null}"#,
        r#"{"version":3,"rig":{"model_id":"hamlib:1","token_values":{}}}"#,
        r#"{"version":4,"rig":null}"#,
        r#"{"version":3,"rig":"invalid"}"#,
        "invalid json",
    ] {
        let directory = TestDir::new();
        fs::write(directory.file(), config).unwrap();
        let (_, service) =
            production_service_with_store(directory.file(), RadioConfigPlatform::windows());
        assert!(!service.capabilities().omnirig_selection_migration_available);
    }
}

#[tokio::test]
async fn migrates_legacy_omnirig_selection_to_both_slots() {
    for (rig, expected) in [(1, "omnirig:1"), (2, "omnirig:2")] {
        let directory = TestDir::new();
        let (radio, service) =
            production_service_with_store(directory.file(), RadioConfigPlatform::windows());
        let response = process_ws(
            format!(
                r#"{{"version":1,"type":"radio","action":"MigrateOmniRigSelection","rig":{rig}}}"#
            ),
            &radio,
            &service,
        )
        .await
        .unwrap()
        .unwrap()
        .into_text()
        .unwrap();
        let response: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(response["event"], "omnirig_selection_migration_result");
        assert_eq!(response["ok"], true);
        assert_eq!(response["migrated"], true);
        assert_eq!(response["effective_model_id"], expected);
        assert_eq!(response.as_object().unwrap().len(), 6);
        assert!(response.get("failure").is_none());
        assert!(response.get("backend").is_none());
        assert!(response.get("rig1").is_none());
        assert!(response.get("rig2").is_none());
        assert_eq!(radio.snapshot().connection, ConnectionState::Disconnected);
        assert_eq!(
            RadioConfig::load_from_path_for_platform(
                &directory.file(),
                RadioConfigPlatform::windows()
            )
            .unwrap()
            .rig
            .unwrap()
            .model_id,
            expected
        );
        assert!(!service.capabilities().omnirig_selection_migration_available);
        radio.shutdown().await.unwrap();
    }
}

#[tokio::test]
async fn invalid_omnirig_migration_request_does_not_write_config() {
    let directory = TestDir::new();
    let (radio, service) =
        production_service_with_store(directory.file(), RadioConfigPlatform::windows());
    let response = process_ws(
        r#"{"version":1,"type":"radio","action":"MigrateOmniRigSelection","rig":3}"#.into(),
        &radio,
        &service,
    )
    .await
    .unwrap()
    .unwrap()
    .into_text()
    .unwrap();
    let response: serde_json::Value = serde_json::from_str(&response).unwrap();
    assert_eq!(response["ok"], false);
    assert_eq!(response["migrated"], false);
    assert_eq!(response["failure"], "invalid_rig");
    assert!(!directory.file().exists());
    radio.shutdown().await.unwrap();
}

#[tokio::test]
async fn repeated_omnirig_migration_request_cannot_overwrite_config() {
    let directory = TestDir::new();
    let (radio, service) =
        production_service_with_store(directory.file(), RadioConfigPlatform::windows());
    process_ws(
        r#"{"version":1,"type":"radio","action":"MigrateOmniRigSelection","rig":1}"#.into(),
        &radio,
        &service,
    )
    .await
    .unwrap();

    let response = process_ws(
        r#"{"version":1,"type":"radio","action":"MigrateOmniRigSelection","rig":2}"#.into(),
        &radio,
        &service,
    )
    .await
    .unwrap()
    .unwrap()
    .into_text()
    .unwrap();
    let response: serde_json::Value = serde_json::from_str(&response).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["migrated"], false);
    assert_eq!(response["effective_model_id"], "omnirig:1");
    assert_eq!(
        RadioConfig::load_from_path_for_platform(&directory.file(), RadioConfigPlatform::windows())
            .unwrap()
            .rig
            .unwrap()
            .model_id,
        "omnirig:1"
    );
    radio.shutdown().await.unwrap();
}

#[tokio::test]
async fn normal_config_write_consumes_migration_availability_before_stale_request() {
    let directory = TestDir::new();
    let (radio, service) =
        production_service_with_store(directory.file(), RadioConfigPlatform::windows());
    let set_response = process_ws(
        r#"{"version":1,"type":"radio","action":"SetRadioConfiguration","configuration":{"rig":{"model_id":"hamlib:1","token_values":{}}}}"#.into(),
        &radio,
        &service,
    )
    .await
    .unwrap()
    .unwrap()
    .into_text()
    .unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&set_response).unwrap()["ok"],
        true
    );

    let response = process_ws(
        r#"{"version":1,"type":"radio","action":"MigrateOmniRigSelection","rig":2}"#.into(),
        &radio,
        &service,
    )
    .await
    .unwrap()
    .unwrap()
    .into_text()
    .unwrap();
    let response: serde_json::Value = serde_json::from_str(&response).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(response["migrated"], false);
    assert_eq!(response["effective_model_id"], "hamlib:1");
    assert_eq!(
        RadioConfig::load_from_path_for_platform(&directory.file(), RadioConfigPlatform::windows())
            .unwrap()
            .rig
            .unwrap()
            .model_id,
        "hamlib:1"
    );
    radio.shutdown().await.unwrap();
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

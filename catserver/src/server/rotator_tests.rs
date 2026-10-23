use std::collections::BTreeMap;

use axum::extract::ws::Message;

use super::{rotator::process, rotator_configuration::RotatorConfiguration};
use crate::{
    hamlib_device_config::HamlibDeviceConfig,
    hamlib_rotator::HamlibRotator,
    rotator::{Rotator, RotatorError, RotatorStatus},
    rotator_config::RotatorConfig,
    rotator_manager::{ActiveRotatorBackend, RotatorManager},
};

fn response_json(message: Message) -> serde_json::Value {
    let Message::Text(text) = message else {
        panic!("expected text response");
    };
    serde_json::from_str(&text).unwrap()
}

#[tokio::test]
async fn lists_rotator_models_with_compatibility() {
    let manager = RotatorManager::new(RotatorConfig::unconfigured()).unwrap();
    let service = RotatorConfiguration::new(manager.clone());
    let response = process(
        r#"{"version":1,"type":"rotator","action":"ListRotatorModels"}"#.into(),
        &manager,
        &service,
    )
    .await
    .unwrap()
    .unwrap();
    let response = response_json(response);

    assert_eq!(response["event"], "rotator_models");
    let models = response["models"].as_array().unwrap();
    assert!(models.iter().any(|model| {
        model["id"] == hamlib::RotatorModelId::NET_ROTCTL.to_string() && model["enabled"] == true
    }));
    assert!(models.iter().any(|model| {
        model["id"] == "701" && model["enabled"] == false && model["disabled_reason"].is_string()
    }));
    manager.shutdown().await.unwrap();
}

#[tokio::test]
async fn stops_rotator_movement() {
    let config = RotatorConfig::hamlib_dummy();
    let selected = ActiveRotatorBackend::Configured(config.hamlib().unwrap().clone());
    let manager = RotatorManager::new(config.clone()).unwrap();
    manager
        .replace(config, selected, || {
            Box::new(HamlibRotator::new(HamlibDeviceConfig {
                model_id: hamlib::RotatorModelId::DUMMY.to_string(),
                token_values: BTreeMap::new(),
            }))
        })
        .await
        .unwrap();
    manager.set_azimuth(180.0).await.unwrap();
    let service = RotatorConfiguration::new(manager.clone());

    let response = process(
        r#"{"version":1,"type":"rotator","action":"Stop"}"#.into(),
        &manager,
        &service,
    )
    .await
    .unwrap();

    let response = response_json(response.unwrap());
    assert_eq!(response["event"], "command_result");
    assert_eq!(response["action"], "Stop");
    assert_eq!(response["ok"], true);
    assert_eq!(manager.snapshot().target_azimuth, None);
    manager.shutdown().await.unwrap();
}

struct StopFailure;

impl Rotator for StopFailure {
    fn init(&mut self) -> Result<(), RotatorError> {
        Ok(())
    }

    fn name(&self) -> &str {
        "stop failure"
    }

    fn set_azimuth(&mut self, _: f64) -> Result<(), RotatorError> {
        Ok(())
    }

    fn stop(&mut self) -> Result<(), RotatorError> {
        Err(RotatorError::new("stop", "unsupported"))
    }

    fn status(&mut self) -> Result<RotatorStatus, RotatorError> {
        Ok(RotatorStatus {
            azimuth: 90.0,
            status: "connected".into(),
            name: self.name().into(),
        })
    }
}

#[tokio::test]
async fn reports_stop_failure_without_clearing_the_target() {
    let config = RotatorConfig::hamlib_dummy();
    let selected = ActiveRotatorBackend::Configured(config.hamlib().unwrap().clone());
    let manager = RotatorManager::new(config.clone()).unwrap();
    manager
        .replace(config, selected, || Box::new(StopFailure))
        .await
        .unwrap();
    manager.set_azimuth(180.0).await.unwrap();
    let service = RotatorConfiguration::new(manager.clone());

    let response = process(
        r#"{"version":1,"type":"rotator","action":"Stop"}"#.into(),
        &manager,
        &service,
    )
    .await
    .unwrap()
    .unwrap();
    let response = response_json(response);

    assert_eq!(response["event"], "command_result");
    assert_eq!(response["action"], "Stop");
    assert_eq!(response["ok"], false);
    assert_eq!(manager.snapshot().target_azimuth, Some(180.0));
    manager.shutdown().await.unwrap();
}

#[tokio::test]
async fn tests_candidate_without_replacing_active_configuration() {
    let manager = RotatorManager::new(RotatorConfig::unconfigured()).unwrap();
    let service = RotatorConfiguration::new(manager.clone());
    let request = serde_json::json!({
        "version": 1,
        "type": "rotator",
        "action": "TestRotatorConnection",
        "configuration": RotatorConfig::Hamlib {
            hamlib: HamlibDeviceConfig {
                model_id: hamlib::RotatorModelId::DUMMY.to_string(),
                token_values: BTreeMap::new(),
            },
        },
    });
    let response = process(request.to_string(), &manager, &service)
        .await
        .unwrap()
        .unwrap();
    let response = response_json(response);

    assert_eq!(response["event"], "rotator_connection_result");
    assert_eq!(response["ok"], true);
    assert_eq!(manager.snapshot().config, RotatorConfig::Unconfigured);
    assert_eq!(
        manager.snapshot().selected,
        ActiveRotatorBackend::Unconfigured
    );
    manager.shutdown().await.unwrap();
}

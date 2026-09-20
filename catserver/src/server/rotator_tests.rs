use std::collections::BTreeMap;

use axum::extract::ws::Message;

use super::{rotator::process, rotator_configuration::RotatorConfiguration};
use crate::{
    hamlib_device_config::HamlibDeviceConfig, rotator_config::RotatorConfig,
    rotator_manager::RotatorManager,
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
    assert_eq!(manager.snapshot().selected, "unconfigured");
    manager.shutdown().await.unwrap();
}

use std::collections::BTreeMap;

use crate::{
    hamlib_device_config::HamlibDeviceConfig,
    hamlib_rotator::HamlibRotator,
    rotator_config::RotatorConfig,
    rotator_manager::{RotatorConnectionState, RotatorManager},
};

#[tokio::test]
async fn dummy_rotator_operates_through_manager() {
    let manager = RotatorManager::new(RotatorConfig::unconfigured()).unwrap();
    let config = HamlibDeviceConfig {
        model_id: hamlib::RotatorModelId::DUMMY.to_string(),
        token_values: BTreeMap::new(),
    };
    let persisted = RotatorConfig::Hamlib {
        hamlib: config.clone(),
    };
    manager
        .replace(persisted, "hamlib-dummy", move || {
            Box::new(HamlibRotator::new(config.clone()))
        })
        .await
        .unwrap();

    assert_eq!(
        manager.snapshot().connection,
        RotatorConnectionState::Connected
    );
    assert_eq!(manager.status().name, "Hamlib Dummy");
    manager.set_azimuth(270.0).await.unwrap();
    manager.poll_status().await.unwrap();
    assert!(manager.status().azimuth.is_finite());
    manager.shutdown().await.unwrap();
}

#[tokio::test]
async fn invalid_token_is_rejected_before_replacement() {
    let manager = RotatorManager::new(RotatorConfig::unconfigured()).unwrap();
    let config = HamlibDeviceConfig {
        model_id: hamlib::RotatorModelId::DUMMY.to_string(),
        token_values: BTreeMap::from([("unknown_token".into(), "value".into())]),
    };
    let persisted = RotatorConfig::Hamlib {
        hamlib: config.clone(),
    };

    assert!(
        manager
            .replace(persisted, "hamlib-dummy", move || {
                Box::new(HamlibRotator::new(config.clone()))
            })
            .await
            .is_err()
    );
    assert_eq!(manager.snapshot().selected, "unconfigured");
    manager.shutdown().await.unwrap();
}

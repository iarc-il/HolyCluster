use std::collections::BTreeMap;

use crate::{
    hamlib_device_config::HamlibDeviceConfig,
    hamlib_rotator::HamlibRotator,
    rotator_manager::{RotatorConnectionState, RotatorManager},
};

#[tokio::test]
async fn dummy_rotator_operates_through_manager() {
    let manager = RotatorManager::new().unwrap();
    let config = HamlibDeviceConfig {
        model_id: hamlib::RotatorModelId::DUMMY.to_string(),
        token_values: BTreeMap::new(),
    };
    manager
        .replace("hamlib-dummy", move || {
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
async fn invalid_token_is_reported_without_losing_selection() {
    let manager = RotatorManager::new().unwrap();
    let config = HamlibDeviceConfig {
        model_id: hamlib::RotatorModelId::DUMMY.to_string(),
        token_values: BTreeMap::from([("unknown_token".into(), "value".into())]),
    };
    manager
        .replace("hamlib-dummy", move || {
            Box::new(HamlibRotator::new(config.clone()))
        })
        .await
        .unwrap();

    let snapshot = manager.snapshot();
    assert_eq!(snapshot.selected, "hamlib-dummy");
    assert_eq!(snapshot.connection, RotatorConnectionState::Disconnected);
    assert!(
        snapshot
            .last_error
            .unwrap()
            .to_string()
            .contains("unknown config token")
    );
    manager.shutdown().await.unwrap();
}

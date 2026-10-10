use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    radio_config::{RadioConfig, RadioConfigError},
    startup_radio,
};

#[test]
fn malformed_persisted_config_keeps_startup_configurable() {
    let path = std::env::temp_dir().join(format!(
        "catserver-startup-radio-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::write(&path, "{").unwrap();

    let loaded = startup_radio::load(&path);

    assert_eq!(loaded.config, RadioConfig::platform_default());
    assert!(matches!(loaded.load_error, Some(RadioConfigError::Json(_))));
    fs::remove_file(path).unwrap();
}

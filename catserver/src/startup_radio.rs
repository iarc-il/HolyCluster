use std::path::Path;

use crate::radio_config::{RadioConfig, RadioConfigError};

pub struct StartupRadioConfig {
    pub config: RadioConfig,
    pub load_error: Option<RadioConfigError>,
}

pub fn load(path: &Path) -> StartupRadioConfig {
    match RadioConfig::load_from_path(path) {
        Ok(config) => StartupRadioConfig {
            config,
            load_error: None,
        },
        Err(error) => StartupRadioConfig {
            config: RadioConfig::platform_default(),
            load_error: Some(error),
        },
    }
}

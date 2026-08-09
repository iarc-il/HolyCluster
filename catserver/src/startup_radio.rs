use std::path::Path;

#[cfg(test)]
use crate::radio_config::RadioConfig;
use crate::radio_config::{AppConfig, RadioConfigError};

#[cfg(test)]
pub struct StartupRadioConfig {
    pub config: RadioConfig,
    pub load_error: Option<RadioConfigError>,
}

#[cfg(test)]
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

pub struct StartupAppConfig {
    pub config: AppConfig,
    pub load_error: Option<RadioConfigError>,
}

pub fn load_app(path: &Path) -> StartupAppConfig {
    match AppConfig::load_from_path(path) {
        Ok(config) => StartupAppConfig {
            config,
            load_error: None,
        },
        Err(error) => StartupAppConfig {
            config: AppConfig::platform_default(),
            load_error: Some(error),
        },
    }
}

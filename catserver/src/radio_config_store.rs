use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use crate::radio_config::{RadioConfig, RadioConfigError};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RadioConfigPlatform {
    omnirig_supported: bool,
}

impl RadioConfigPlatform {
    pub const fn current() -> Self {
        Self {
            omnirig_supported: cfg!(windows),
        }
    }

    #[cfg(test)]
    pub const fn windows() -> Self {
        Self {
            omnirig_supported: true,
        }
    }

    #[cfg(test)]
    pub const fn non_windows() -> Self {
        Self {
            omnirig_supported: false,
        }
    }

    pub const fn omnirig_supported(self) -> bool {
        self.omnirig_supported
    }
}

#[derive(Clone)]
pub struct RadioConfigStore {
    path: PathBuf,
    platform: RadioConfigPlatform,
    migration_consumed: Arc<AtomicBool>,
}

impl RadioConfigStore {
    pub fn production() -> Result<Self, RadioConfigError> {
        Ok(Self::new(
            RadioConfig::config_path()?,
            RadioConfigPlatform::current(),
        ))
    }

    pub fn new(path: PathBuf, platform: RadioConfigPlatform) -> Self {
        Self {
            path,
            platform,
            migration_consumed: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn platform(&self) -> RadioConfigPlatform {
        self.platform
    }

    pub fn omnirig_selection_migration_available(&self) -> Result<bool, RadioConfigError> {
        Ok(self.platform.omnirig_supported()
            && !self.migration_consumed.load(Ordering::SeqCst)
            && !RadioConfig::valid_v3_exists_at_path_for_platform(&self.path, self.platform)?)
    }

    pub fn save(&self, config: &RadioConfig) -> Result<(), RadioConfigError> {
        config.save_to_path_for_platform(&self.path, self.platform)?;
        self.migration_consumed.store(true, Ordering::SeqCst);
        Ok(())
    }

    pub fn save_migration_if_available(
        &self,
        config: &RadioConfig,
    ) -> Result<bool, RadioConfigError> {
        if !self.omnirig_selection_migration_available()? {
            return Ok(false);
        }
        self.save(config)?;
        Ok(true)
    }
}

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct UpdateSession {
    pub id: String,
    pub expected_version: String,
    pub port: u16,
    pub origin: String,
    pub capability: String,
    pub phase: String,
    pub downloaded: u64,
    pub total: u64,
    pub helper_url: Option<String>,
    pub installer_outcome: Option<String>,
    pub diagnostic: Option<String>,
    pub log_path: String,
}

impl UpdateSession {
    pub(crate) fn terminal(&self) -> bool {
        matches!(
            self.phase.as_str(),
            "updated" | "failed" | "permission_cancelled" | "reboot_required" | "restart_failed"
        )
    }
}

pub(crate) struct SessionStore {
    path: PathBuf,
    data: Mutex<UpdateSession>,
}

impl SessionStore {
    pub(crate) fn create(
        path: PathBuf,
        id: String,
        port: u16,
        origin: String,
        version: String,
        total: u64,
    ) -> Result<Arc<Self>> {
        let data = UpdateSession {
            id,
            port,
            expected_version: version,
            origin,
            capability: uuid::Uuid::new_v4().to_string(),
            phase: "downloading".into(),
            downloaded: 0,
            total,
            helper_url: None,
            installer_outcome: None,
            diagnostic: None,
            log_path: path
                .with_file_name("msi-install.log")
                .to_string_lossy()
                .into_owned(),
        };
        let store = Arc::new(Self {
            path,
            data: Mutex::new(data),
        });
        store.change(|_| {})?;
        Ok(store)
    }

    pub(crate) fn load(path: &Path) -> Result<Arc<Self>> {
        Ok(Arc::new(Self {
            path: path.to_owned(),
            data: Mutex::new(read_session(path).context("cannot load update session")?),
        }))
    }

    pub(crate) fn snapshot(&self) -> UpdateSession {
        self.data
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub(crate) fn change(&self, action: impl FnOnce(&mut UpdateSession)) -> Result<()> {
        let mut data = self.data.lock().unwrap_or_else(|error| error.into_inner());
        action(&mut data);
        crate::updater::write_json(&self.path, &*data)
    }

    pub(crate) fn phase(&self, phase: &str) -> Result<()> {
        self.change(|data| data.phase = phase.to_owned())
    }
}

pub(crate) fn read_session(path: &Path) -> Option<UpdateSession> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

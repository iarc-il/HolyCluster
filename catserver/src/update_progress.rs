use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[cfg(target_os = "linux")]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct UpdateOwner {
    pub pid: u32,
    pub started_at: u64,
    #[serde(default)]
    pub boot_id: String,
}

#[cfg(target_os = "linux")]
impl UpdateOwner {
    pub(crate) fn active(&self, proc_root: &Path) -> Result<bool> {
        Ok(
            fs::read_to_string(proc_root.join("sys/kernel/random/boot_id"))?.trim() == self.boot_id
                && Self::start_time(proc_root, self.pid)? == Some(self.started_at),
        )
    }

    pub(crate) fn start_time(proc_root: &Path, pid: u32) -> Result<Option<u64>> {
        let stat = match fs::read_to_string(proc_root.join(pid.to_string()).join("stat")) {
            Ok(stat) => stat,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        Ok(Some(
            stat.rsplit_once(')')
                .context("invalid process stat")?
                .1
                .split_whitespace()
                .nth(19)
                .context("missing process start time")?
                .parse()?,
        ))
    }

    fn current() -> Result<Self> {
        let pid = std::process::id();
        Ok(Self {
            pid,
            started_at: Self::start_time(Path::new("/proc"), pid)?
                .context("update owner process is missing")?,
            boot_id: fs::read_to_string("/proc/sys/kernel/random/boot_id")?
                .trim()
                .to_owned(),
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct UpdateSession {
    pub id: String,
    #[cfg(target_os = "linux")]
    #[serde(default)]
    pub owner: Option<UpdateOwner>,
    pub expected_version: String,
    pub port: u16,
    pub origin: String,
    pub capability: String,
    pub phase: String,
    pub downloaded: u64,
    pub total: u64,
    pub helper_url: Option<String>,
    #[serde(default)]
    pub ui_attached: bool,
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
            #[cfg(target_os = "linux")]
            owner: Some(UpdateOwner::current()?),
            port,
            expected_version: version,
            origin,
            capability: uuid::Uuid::new_v4().to_string(),
            phase: "downloading".into(),
            downloaded: 0,
            total,
            helper_url: None,
            ui_attached: false,
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

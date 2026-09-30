use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub(crate) struct InstallerEvent {
    pub id: Option<String>,
    pub phase: String,
    pub exit_code: Option<u32>,
    pub cancelled: bool,
    pub unconfirmed: bool,
    pub diagnostic: Option<String>,
}

#[cfg(windows)]
pub(crate) fn request(
    plan_path: &std::path::Path,
    event_path: &std::path::Path,
    id: Option<&str>,
    progress: Option<&std::sync::Arc<crate::update_progress::SessionStore>>,
) -> anyhow::Result<u32> {
    use std::{
        fs,
        process::Command,
        time::{Duration, Instant},
    };
    if event_path.exists() {
        fs::remove_file(event_path)?;
    }
    let mut command = Command::new(std::env::current_exe()?);
    command.arg("--elevate-update").arg(plan_path);
    let mut broker = crate::windows_sockets::spawn(&mut command)?;
    let deadline = Instant::now() + Duration::from_secs(2100);
    loop {
        let event = fs::read(event_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<InstallerEvent>(&bytes).ok());
        if let Some(event) = &event
            && event.id.as_deref() == id
            && event.phase == "installing"
            && let Some(store) = progress
            && store.snapshot().phase != "installing"
        {
            store.phase("installing").map_err(|error| {
                anyhow::Error::new(crate::updater::InstallerUnconfirmed).context(error)
            })?;
        }
        if broker
            .try_wait()
            .map_err(|error| {
                anyhow::Error::new(crate::updater::InstallerUnconfirmed).context(error)
            })?
            .is_some()
        {
            let event = fs::read(event_path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<InstallerEvent>(&bytes).ok());
            if let Some(event) = event
                && event.id.as_deref() == id
                && event.phase == "finished"
            {
                if event.unconfirmed {
                    return Err(crate::updater::InstallerUnconfirmed.into());
                }
                if let Some(code) = event.exit_code {
                    return Ok(code);
                }
                if event.cancelled {
                    return Err(std::io::Error::from_raw_os_error(
                        windows_sys::Win32::Foundation::ERROR_CANCELLED as i32,
                    )
                    .into());
                }
                anyhow::bail!(
                    "{}",
                    event
                        .diagnostic
                        .unwrap_or_else(|| "MSI broker failed".into())
                );
            }
            return Err(crate::updater::InstallerUnconfirmed.into());
        }
        if Instant::now() >= deadline {
            let _ = broker.kill();
            let _ = broker.wait();
            return Err(crate::updater::InstallerUnconfirmed.into());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

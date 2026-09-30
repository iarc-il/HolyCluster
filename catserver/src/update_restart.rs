#[cfg(windows)]
use crate::update_progress::SessionStore;
use crate::updater::RestartContext;
#[cfg(windows)]
use anyhow::bail;
use anyhow::{Context, Result};
#[cfg(windows)]
use std::{
    fs,
    process::Child,
    sync::Arc,
    time::{Duration, Instant},
};

#[cfg(windows)]
pub(crate) fn wait_until_ready(
    context: &RestartContext,
    child: &mut Child,
    progress: &Arc<SessionStore>,
) -> Result<()> {
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(2))
        .build()?;
    let deadline = Instant::now() + Duration::from_secs(210);
    let marker =
        std::path::Path::new(&progress.snapshot().log_path).with_file_name("restart-startup.json");
    let mut conflict = false;
    loop {
        if let Some(status) = child.try_wait()? {
            bail!(
                "CAT Control exited during restart ({status}); inspect the application and MSI logs"
            );
        }
        if let Ok(response) = client
            .get(format!("http://127.0.0.1:{}/api/ready", context.port))
            .send()
            && response.status().is_success()
            && let Ok(body) = response.text()
            && let Ok(ready) = serde_json::from_str::<serde_json::Value>(&body)
        {
            if ready["update_id"] == context.id
                && ready["version"] == context.expected_version
                && ready["verified"] == true
            {
                return Ok(());
            }
            conflict = ready["instance_id"].is_string();
        }
        if let Ok(data) = fs::read(&marker)
            && let Ok(signal) = serde_json::from_slice::<serde_json::Value>(&data)
            && signal["id"] == context.id
        {
            if let Some(diagnostic) = signal["diagnostic"].as_str() {
                bail!("{diagnostic}");
            }
            if signal["phase"] == "waiting_for_local_port"
                && progress.snapshot().phase != "waiting_for_local_port"
            {
                progress.phase("waiting_for_local_port")?;
            }
        }
        if Instant::now() >= deadline {
            if conflict {
                bail!(
                    "The original local port {} is responding from another application or update identity; no update success was confirmed",
                    context.port
                );
            }
            bail!(
                "CAT Control did not become ready on original port {}; installation succeeded but restart was not verified",
                context.port
            );
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

#[cfg(windows)]
pub(crate) fn wait_for_parent(pid: u32) -> Result<()> {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows_sys::Win32::{
        Foundation::{ERROR_INVALID_PARAMETER, WAIT_OBJECT_0},
        System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject},
    };
    let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
    if handle.is_null() {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(ERROR_INVALID_PARAMETER as i32) {
            return Ok(());
        }
        return Err(error).context("cannot verify that the old CAT Control process exited");
    }
    let owned = unsafe { OwnedHandle::from_raw_handle(handle) };
    let wait = unsafe { WaitForSingleObject(owned.as_raw_handle(), 120000) };
    anyhow::ensure!(
        wait == WAIT_OBJECT_0,
        "CAT Control did not stop within two minutes; installer was not started"
    );
    Ok(())
}

pub(crate) fn startup_signal(
    context: &RestartContext,
    path: &std::path::Path,
    diagnostic: Option<String>,
) -> Result<()> {
    crate::updater::write_json(path, &serde_json::json!({ "id": context.id, "phase": "waiting_for_local_port", "diagnostic": diagnostic })).context("cannot persist update startup signal")
}

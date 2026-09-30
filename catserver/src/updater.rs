#[cfg(any(test, windows))]
use std::ffi::OsString;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
#[cfg(target_os = "linux")]
use std::os::unix::process::CommandExt;
use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    time::Duration,
};

use crate::update_progress::{SessionStore, UpdateSession};
use anyhow::{Context, Result, bail};
use directories::ProjectDirs;
use reqwest::{Url, blocking::Client, redirect::Policy};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug)]
pub(crate) struct UpdateBusy;
impl std::fmt::Display for UpdateBusy {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("An update is already in progress; no second installer was started")
    }
}
impl std::error::Error for UpdateBusy {}

const MAX_ARTIFACT_SIZE: u64 = 512 * 1024 * 1024;
pub(crate) const PLATFORM_LINUX: &str = "linux-appimage";
pub(crate) const PLATFORM_WINDOWS: &str = "windows-msi";

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReleaseManifest {
    #[allow(dead_code)]
    pub schema_version: u32,
    pub releases: Vec<AppRelease>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppRelease {
    pub version: String,
    pub platform: String,
    #[allow(dead_code)]
    pub architecture: String,
    pub artifact: Artifact,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Artifact {
    #[serde(alias = "location")]
    pub url: String,
    pub name: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct UpdateStatus {
    pub state: UpdateState,
    pub available_version: Option<String>,
    pub diagnostic: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UpdateState {
    Idle,
    Deferred,
    Available,
    Downloaded,
    Installing,
    Installed,
    RebootRequired,
    Failed,
}

impl Default for UpdateStatus {
    fn default() -> Self {
        Self {
            state: UpdateState::Idle,
            available_version: None,
            diagnostic: None,
        }
    }
}

#[derive(Clone)]
pub struct UpdateService {
    manifest_url: Url,
    current_version: Version,
    dev_mode: bool,
    platform: &'static str,
    data_dir: PathBuf,
    local_port: u16,
    instance_id: String,
    resumed: Option<RestartContext>,
    action_lock: Arc<Mutex<()>>,
    origin: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct LocalReadiness {
    pub version: String,
    pub instance_id: String,
    pub update_id: Option<String>,
    pub verified: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct RestartContext {
    pub id: String,
    pub port: u16,
    pub expected_version: String,
}

pub(crate) fn restart_context(path: &Path) -> Result<RestartContext> {
    let plan: InstallPlan = serde_json::from_slice(&fs::read(path)?)?;
    let context = plan.restart.context("update plan has no restart context")?;
    anyhow::ensure!(
        context.port != 0,
        "update restart requires the original port"
    );
    parse_version(&context.expected_version)?;
    Ok(context)
}

#[derive(Deserialize, Serialize)]
struct InstallPlan {
    current_executable: PathBuf,
    staged_artifact: PathBuf,
    artifact: Artifact,
    state_path: PathBuf,
    parent_pid: u32,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    reinstall: bool,
    #[serde(default)]
    command_args: Vec<String>,
    #[serde(default)]
    restart: Option<RestartContext>,
}

#[cfg(any(test, windows))]
#[derive(Deserialize, Serialize)]
pub(crate) struct UpdateHelper {
    pid: u32,
    started_at: u64,
}

impl UpdateService {
    pub fn new(manifest_url: Url, current_version: &str) -> Result<Self> {
        if !is_secure_url(&manifest_url) {
            bail!("update manifest URL must use HTTPS");
        }
        let project_dirs = ProjectDirs::from("org", "IARC", "HolyCluster")
            .context("cannot determine update data directory")?;
        Self::with_data_dir(
            manifest_url,
            current_version,
            project_dirs.data_local_dir().join("updates"),
        )
    }

    pub(crate) fn with_data_dir(
        manifest_url: Url,
        current_version: &str,
        data_dir: PathBuf,
    ) -> Result<Self> {
        let service = Self {
            manifest_url,
            current_version: parse_version(current_version)?,
            dev_mode: false,
            platform: platform(),
            data_dir,
            local_port: 0,
            instance_id: uuid::Uuid::new_v4().to_string(),
            resumed: None,
            action_lock: Arc::new(Mutex::new(())),
            origin: None,
        };
        service.reconcile_installed_status()?;
        #[cfg(windows)]
        service.reconcile_installing_status_with(update_helper_active)?;
        Ok(service)
    }

    pub(crate) fn with_local_port(mut self, port: u16) -> Self {
        self.local_port = port;
        self
    }

    pub(crate) fn with_restart(mut self, context: Option<RestartContext>) -> Self {
        self.resumed = context;
        self
    }

    pub(crate) fn readiness(&self) -> LocalReadiness {
        LocalReadiness {
            version: self.current_version.to_string(),
            instance_id: self.instance_id.clone(),
            update_id: self.resumed.as_ref().map(|context| context.id.clone()),
            verified: self.resumed.as_ref().is_some_and(|context| {
                parse_version(&context.expected_version)
                    .is_ok_and(|version| version == self.current_version)
            }),
        }
    }

    pub(crate) fn with_origin(mut self, origin: String) -> Self {
        self.origin = Some(origin);
        self
    }

    pub(crate) fn session(&self) -> Option<UpdateSession> {
        SessionStore::load(&self.session_path())
            .ok()
            .map(|store| store.snapshot())
    }

    pub(crate) fn exclusive<T>(&self, action: impl FnOnce() -> Result<T>) -> Result<T> {
        let _guard = match self.action_lock.try_lock() {
            Ok(guard) => guard,
            Err(std::sync::TryLockError::Poisoned(error)) => error.into_inner(),
            Err(std::sync::TryLockError::WouldBlock) => return Err(UpdateBusy.into()),
        };
        if self.session().is_some_and(|session| !session.terminal()) {
            return Err(UpdateBusy.into());
        }
        if self.session_path().exists() {
            fs::remove_file(self.session_path())?;
        }
        action()
    }

    fn session_path(&self) -> PathBuf {
        self.data_dir.join("session.json")
    }

    pub fn with_dev_mode(mut self, dev_mode: bool) -> Self {
        self.dev_mode = dev_mode;
        self
    }

    pub fn status(&self) -> UpdateStatus {
        read_status(&self.state_path()).unwrap_or_default()
    }

    #[cfg(any(test, windows))]
    pub(crate) fn reconcile_installing_status_with(
        &self,
        is_active: impl FnOnce(&UpdateHelper) -> Option<bool>,
    ) -> Result<()> {
        if self.status().state != UpdateState::Installing {
            return Ok(());
        }
        let Ok(data) = fs::read(self.helper_path()) else {
            return Ok(());
        };
        let Ok(helper) = serde_json::from_slice::<UpdateHelper>(&data) else {
            return Ok(());
        };
        if is_active(&helper) == Some(false) && self.status().state == UpdateState::Installing {
            self.record_failure("Update helper exited before reporting an installation result")?;
        }
        Ok(())
    }

    fn reconcile_installed_status(&self) -> Result<()> {
        let status = self.status();
        if status.state == UpdateState::Installed
            && status
                .available_version
                .as_deref()
                .and_then(|version| parse_version(version).ok())
                .is_some_and(|version| self.current_version >= version)
        {
            self.write_status(&UpdateStatus::default())?;
        }
        Ok(())
    }

    pub fn defer(&self) -> Result<UpdateStatus> {
        let mut status = self.status();
        status.state = UpdateState::Deferred;
        status.diagnostic = None;
        self.write_status(&status)?;
        Ok(status)
    }

    pub fn retry(&self) -> Result<UpdateStatus> {
        let status = UpdateStatus::default();
        self.write_status(&status)?;
        Ok(status)
    }

    pub fn record_failure(&self, diagnostic: impl Into<String>) -> Result<UpdateStatus> {
        let diagnostic = diagnostic.into();
        if let Ok(store) = SessionStore::load(&self.session_path()) {
            store.change(|session| {
                session.phase = "failed".into();
                session.diagnostic = Some(diagnostic.clone());
            })?;
        }
        let status = UpdateStatus {
            state: UpdateState::Failed,
            available_version: None,
            diagnostic: Some(diagnostic),
        };
        self.write_status(&status)?;
        Ok(status)
    }

    pub fn check(&self) -> Result<UpdateStatus> {
        let result = self
            .fetch_manifest()
            .and_then(|manifest| self.accept_manifest(manifest));
        match result {
            Ok(Some((version, _))) => {
                let status = UpdateStatus {
                    state: UpdateState::Available,
                    available_version: Some(version.to_string()),
                    diagnostic: None,
                };
                self.write_status(&status)?;
                Ok(status)
            }
            Ok(None) => {
                let status = UpdateStatus::default();
                self.write_status(&status)?;
                Ok(status)
            }
            Err(error) => self.fail(error),
        }
    }

    pub fn download(&self) -> Result<UpdateStatus> {
        self.download_inner().or_else(|error| self.fail(error))
    }

    fn download_inner(&self) -> Result<UpdateStatus> {
        let manifest = self.fetch_manifest()?;
        let Some((version, artifact)) = self.accept_manifest(manifest)? else {
            let status = UpdateStatus::default();
            self.write_status(&status)?;
            return Ok(status);
        };
        fs::create_dir_all(self.staging_dir())?;
        let staged = self
            .staging_dir()
            .join(format!("{}-{}.part", version, self.platform));
        let final_path = self
            .staging_dir()
            .join(format!("{}-{}", version, artifact.name));
        let restart = (cfg!(windows) && self.local_port != 0).then(|| RestartContext {
            id: uuid::Uuid::new_v4().to_string(),
            port: self.local_port,
            expected_version: version.to_string(),
        });
        let progress = restart
            .as_ref()
            .map(|context| {
                SessionStore::create(
                    self.session_path(),
                    context.id.clone(),
                    context.port,
                    self.origin
                        .clone()
                        .unwrap_or_else(|| format!("http://127.0.0.1:{}", context.port)),
                    context.expected_version.clone(),
                    artifact.size,
                )
            })
            .transpose()?;
        download_artifact(&artifact, &staged, progress.as_ref())?;
        if let Some(progress) = &progress {
            progress.phase("verifying")?;
        }
        verify_file(&staged, &artifact)?;
        fs::rename(&staged, &final_path)?;
        let status = UpdateStatus {
            state: UpdateState::Downloaded,
            available_version: Some(version.to_string()),
            diagnostic: None,
        };
        self.write_status(&status)?;
        let current_executable = update_target()?;
        #[cfg(not(windows))]
        {
            let activation = current_executable.with_extension("AppImage.update");
            if activation.exists() {
                tracing::warn!(path = ?activation, "Removing stale AppImage activation");
                fs::remove_file(&activation).context("cannot remove stale AppImage activation")?;
            }
        }
        fs::write(
            self.plan_path(),
            serde_json::to_vec(&InstallPlan {
                current_executable,
                staged_artifact: final_path,
                artifact,
                state_path: self.state_path(),
                parent_pid: std::process::id(),
                reinstall: self.dev_mode && version == self.current_version,
                version: Some(version.to_string()),
                command_args: original_arguments(&std::env::args().skip(1).collect::<Vec<_>>()),
                restart,
            })?,
        )?;
        Ok(status)
    }

    pub fn start_install(&self) -> Result<()> {
        let status = self.status();
        if status.state != UpdateState::Downloaded {
            bail!("an update must be downloaded before installation");
        }
        let installing = UpdateStatus {
            state: UpdateState::Installing,
            available_version: status.available_version,
            diagnostic: None,
        };
        #[cfg(windows)]
        return self.start_windows_helper(&installing);
        #[cfg(not(windows))]
        {
            close_inherited_descriptors_on_exec()?;
            self.write_status(&installing)
        }
    }

    #[cfg(windows)]
    fn start_windows_helper(&self, installing: &UpdateStatus) -> Result<()> {
        let executable = std::env::current_exe()?;
        let helper_path = self.data_dir.join("update-helper.exe");
        fs::create_dir_all(&self.data_dir)?;
        fs::copy(executable, &helper_path).context("cannot stage update helper")?;
        let mut command = Command::new(helper_path);
        command.arg("--apply-update").arg(self.plan_path());
        let mut helper = crate::windows_sockets::spawn(&mut command)
            .context("cannot start detached update helper")?;
        let result = (|| {
            let identity = UpdateHelper {
                pid: helper.id(),
                started_at: windows_process_start_time(
                    std::os::windows::io::AsRawHandle::as_raw_handle(&helper),
                )?,
            };
            write_json(&self.helper_path(), &identity)?;
            self.write_status(installing)
        })();
        if let Err(error) = result {
            let _ = helper.kill();
            let _ = helper.wait();
            return Err(error);
        }
        tracing::info!(pid = helper.id(), "Detached update helper started");
        Ok(())
    }

    fn fetch_manifest(&self) -> Result<ReleaseManifest> {
        let response = secure_client()
            .get(self.manifest_url.clone())
            .send()?
            .error_for_status()?;
        Ok(serde_json::from_reader(response)?)
    }

    pub(crate) fn accept_manifest(
        &self,
        manifest: ReleaseManifest,
    ) -> Result<Option<(Version, Artifact)>> {
        fn map_platform(backend: &str) -> Option<&'static str> {
            match backend {
                "linux" => Some(PLATFORM_LINUX),
                "windows" => Some(PLATFORM_WINDOWS),
                _ => None,
            }
        }

        let release = manifest
            .releases
            .iter()
            .find(|r| map_platform(&r.platform) == Some(self.platform))
            .context("release does not contain an artifact for this platform")?;
        let version = parse_version(&release.version)?;
        if version < self.current_version || (version == self.current_version && !self.dev_mode) {
            return Ok(None);
        }
        let mut artifact = release.artifact.clone();
        artifact.url = self.manifest_url.join(&artifact.url)?.to_string();
        validate_artifact(&artifact, self.platform)?;
        Ok(Some((version, artifact)))
    }

    fn fail<T>(&self, error: anyhow::Error) -> Result<T> {
        self.record_failure(error.to_string())?;
        Err(error)
    }

    fn state_path(&self) -> PathBuf {
        self.data_dir.join("state.json")
    }
    fn plan_path(&self) -> PathBuf {
        self.data_dir.join("install-plan.json")
    }
    #[cfg(any(test, windows))]
    fn helper_path(&self) -> PathBuf {
        self.data_dir.join("update-helper.json")
    }
    fn staging_dir(&self) -> PathBuf {
        self.data_dir.join("staging")
    }

    fn write_status(&self, status: &UpdateStatus) -> Result<()> {
        write_json(&self.state_path(), status)
    }
}

pub fn run_helper(plan_path: &Path) -> Result<()> {
    tracing::info!(plan = ?plan_path, "Loading update plan");
    let plan: InstallPlan =
        serde_json::from_slice(&fs::read(plan_path)?).context("cannot load update plan")?;
    tracing::info!(
        parent_pid = plan.parent_pid,
        current = ?plan.current_executable,
        staged = ?plan.staged_artifact,
        "Update helper started"
    );
    #[cfg(windows)]
    wait_for_parent(plan.parent_pid);
    tracing::info!("Parent catserver exited; applying update");
    let result = if cfg!(windows) {
        install_windows(&plan)
    } else {
        install_linux(&plan)
    };
    let status = match &result {
        Ok(state) => UpdateStatus {
            state: state.clone(),
            available_version: plan.version.clone(),
            diagnostic: None,
        },
        Err(error) => UpdateStatus {
            state: UpdateState::Failed,
            available_version: None,
            diagnostic: Some(error.to_string()),
        },
    };
    if let Err(error) = &result {
        tracing::error!(?error, "Update helper failed");
    }
    write_json(&plan.state_path, &status).context("cannot persist update helper status")?;
    #[cfg(windows)]
    if result
        .as_ref()
        .is_ok_and(|state| *state == UpdateState::Installed)
        || result.is_err()
    {
        let mut command = restart_command(&plan, plan_path);
        if let Err(error) = crate::windows_sockets::spawn(&mut command) {
            tracing::error!(?error, "Cannot restart catserver after installation");
            write_json(
                &plan.state_path,
                &UpdateStatus {
                    state: status.state.clone(),
                    available_version: status.available_version.clone(),
                    diagnostic: Some(format!(
                        "Installer outcome: {:?}; CAT Control restart failed: {error}; see msi-install.log",
                        status.state
                    )),
                },
            )?;
            return Err(error.into());
        }
    }
    #[cfg(windows)]
    if result
        .as_ref()
        .is_ok_and(|state| *state == UpdateState::RebootRequired)
    {
        windows_elevation::notify_reboot_required();
    }
    #[cfg(target_os = "linux")]
    if result
        .as_ref()
        .is_ok_and(|state| *state == UpdateState::Installed)
        && let Err(error) = exec_linux(&plan)
    {
        tracing::error!(?error, "Updated AppImage handoff failed");
        write_json(
            &plan.state_path,
            &UpdateStatus {
                state: UpdateState::Failed,
                available_version: None,
                diagnostic: Some(error.to_string()),
            },
        )?;
        return Err(error);
    }
    if result.is_ok() {
        tracing::info!("Update helper completed successfully");
    }
    result.map(drop)
}

fn install_linux(plan: &InstallPlan) -> Result<UpdateState> {
    if platform() != PLATFORM_LINUX || !is_appimage(&plan.current_executable) {
        bail!(
            "automatic update is only supported for APPIMAGE-backed executables; update manually"
        );
    }
    verify_file(&plan.staged_artifact, &plan.artifact)?;
    let backup = plan.current_executable.with_extension("AppImage.previous");
    let activation = plan.current_executable.with_extension("AppImage.update");
    if activation.exists() {
        bail!("a previous update activation file exists; update manually");
    }
    fs::copy(&plan.staged_artifact, &activation)?;
    if let Err(error) =
        make_executable(&activation).and_then(|()| verify_file(&activation, &plan.artifact))
    {
        let _ = fs::remove_file(&activation);
        return Err(error).context("cannot prepare staged AppImage for activation");
    }
    fs::rename(&plan.current_executable, &backup).context("cannot back up current AppImage")?;
    if let Err(error) = fs::rename(&activation, &plan.current_executable) {
        let _ = fs::rename(&backup, &plan.current_executable);
        return Err(error).context("cannot activate updated AppImage; previous version restored");
    }
    Ok(UpdateState::Installed)
}

#[cfg(target_os = "linux")]
fn exec_linux(plan: &InstallPlan) -> Result<()> {
    let mut command = Command::new(&plan.current_executable);
    command.args(&plan.command_args);
    let error = command.exec();
    let activation = plan.current_executable.with_extension("AppImage.update");
    let backup = plan.current_executable.with_extension("AppImage.previous");
    let _ = fs::rename(&plan.current_executable, &activation);
    let _ = fs::rename(&backup, &plan.current_executable);
    let _ = fs::remove_file(&activation);
    Err(error).context("cannot exec updated AppImage; previous version restored")
}

#[cfg(unix)]
pub(crate) fn make_executable(path: &Path) -> Result<()> {
    fs::set_permissions(path, fs::Permissions::from_mode(0o755))?;
    Ok(())
}

#[cfg(not(unix))]
pub(crate) fn make_executable(_path: &Path) -> Result<()> {
    Ok(())
}

pub(crate) fn original_arguments(arguments: &[String]) -> Vec<String> {
    let mut result = Vec::new();
    let mut arguments = arguments.iter();
    while let Some(argument) = arguments.next() {
        if argument == "--resume-update" {
            arguments.next();
        } else if !argument.starts_with("--resume-update=") {
            result.push(argument.clone());
        }
    }
    result
}

#[cfg(windows)]
fn restart_command(plan: &InstallPlan, plan_path: &Path) -> Command {
    let mut command = Command::new(&plan.current_executable);
    command.args(original_arguments(&plan.command_args));
    if plan.restart.is_some() {
        command.arg("--resume-update").arg(plan_path);
    }
    command
}

fn install_windows(plan: &InstallPlan) -> Result<UpdateState> {
    if platform() != PLATFORM_WINDOWS {
        bail!("Windows installer received on unsupported platform");
    }
    verify_file(&plan.staged_artifact, &plan.artifact)?;
    let log_path = plan.state_path.with_file_name("msi-install.log");
    if log_path.exists() {
        fs::remove_file(&log_path).context("cannot remove previous MSI installer log")?;
    }
    let state = windows_install_state(run_elevated_windows_installer(
        &plan.staged_artifact,
        &log_path,
        plan.reinstall,
    )?)?;
    Ok(state)
}

pub(crate) fn windows_install_state(exit_code: u32) -> Result<UpdateState> {
    match exit_code {
        0 => Ok(UpdateState::Installed),
        3010 => Ok(UpdateState::RebootRequired),
        _ => bail!(
            "MSI installer exited with code {exit_code}; see msi-install.log; MSI rollback is not guaranteed"
        ),
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn close_inherited_descriptors_on_exec() -> Result<()> {
    for entry in fs::read_dir("/proc/self/fd")? {
        let entry = entry?;
        let fd = entry.file_name().to_string_lossy().parse::<libc::c_int>()?;
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
        if flags == -1 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::EBADF) {
                continue;
            }
            return Err(error.into());
        }
        let flags = if fd <= libc::STDERR_FILENO {
            flags & !libc::FD_CLOEXEC
        } else {
            flags | libc::FD_CLOEXEC
        };
        if unsafe { libc::fcntl(fd, libc::F_SETFD, flags) } == -1 {
            return Err(io::Error::last_os_error().into());
        }
    }
    Ok(())
}

#[cfg(all(not(target_os = "linux"), not(windows)))]
pub(crate) fn close_inherited_descriptors_on_exec() -> Result<()> {
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn exec_pending_update() -> Result<()> {
    let project_dirs = ProjectDirs::from("org", "IARC", "HolyCluster")
        .context("cannot determine update data directory")?;
    let data_dir = project_dirs.data_local_dir().join("updates");
    let state_path = data_dir.join("state.json");
    if read_status(&state_path).unwrap_or_default().state != UpdateState::Installing {
        return Ok(());
    }
    run_helper(&data_dir.join("install-plan.json"))
}

#[cfg(not(target_os = "linux"))]
pub fn exec_pending_update() -> Result<()> {
    Ok(())
}

#[cfg(any(test, windows))]
pub(crate) fn windows_installer_arguments(
    msi: &Path,
    log: &Path,
    reinstall: bool,
) -> Vec<OsString> {
    let mut arguments = vec![
        "/i".into(),
        msi.as_os_str().to_owned(),
        "/qn".into(),
        "/norestart".into(),
        "/L*v".into(),
        log.as_os_str().to_owned(),
    ];
    if reinstall {
        arguments.extend(["REINSTALL=ALL".into(), "REINSTALLMODE=vamus".into()]);
    }
    arguments
}

#[cfg(windows)]
fn run_elevated_windows_installer(msi: &Path, log: &Path, reinstall: bool) -> Result<u32> {
    windows_elevation::run(
        "msiexec.exe",
        &windows_installer_arguments(msi, log, reinstall),
    )
}

#[cfg(not(windows))]
fn run_elevated_windows_installer(_msi: &Path, _log: &Path, _reinstall: bool) -> Result<u32> {
    bail!("Windows installer received on unsupported platform")
}

#[cfg(windows)]
mod windows_elevation {
    use std::{io, os::windows::ffi::OsStrExt};

    use anyhow::{Context, Result, bail};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, WAIT_OBJECT_0},
        System::Threading::{GetExitCodeProcess, INFINITE, WaitForSingleObject},
        UI::{
            Shell::{SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW},
            WindowsAndMessaging::{
                MB_ICONINFORMATION, MB_OK, MB_SETFOREGROUND, MB_TOPMOST, MessageBoxW, SW_SHOWNORMAL,
            },
        },
    };

    use super::{OsString, quote_windows_argument};

    pub(super) fn run(program: &str, arguments: &[OsString]) -> Result<u32> {
        let verb = wide("runas");
        let program = wide(program);
        let parameters = command_line(arguments);
        let mut info = SHELLEXECUTEINFOW {
            cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOCLOSEPROCESS,
            lpVerb: verb.as_ptr(),
            lpFile: program.as_ptr(),
            lpParameters: parameters.as_ptr(),
            nShow: SW_SHOWNORMAL,
            ..Default::default()
        };
        if unsafe { ShellExecuteExW(&mut info) } == 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(windows_sys::Win32::Foundation::ERROR_CANCELLED as i32)
            {
                return Err(error).context("Windows elevation was canceled");
            }
            return Err(error).context("cannot start elevated MSI installer");
        }
        if info.hProcess.is_null() {
            bail!("elevated MSI installer did not return a process handle");
        }
        let wait = unsafe { WaitForSingleObject(info.hProcess, INFINITE) };
        if wait != WAIT_OBJECT_0 {
            unsafe { CloseHandle(info.hProcess) };
            bail!("cannot wait for elevated MSI installer: {wait:#x}");
        }
        let mut exit_code = 0;
        let result = unsafe { GetExitCodeProcess(info.hProcess, &mut exit_code) };
        unsafe { CloseHandle(info.hProcess) };
        if result == 0 {
            return Err(io::Error::last_os_error()).context("cannot read MSI installer exit code");
        }
        Ok(exit_code)
    }

    pub(super) fn notify_reboot_required() {
        let message = wide("Restart Windows to finish installing CAT Control.");
        let title = wide("CAT Control update");
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                message.as_ptr(),
                title.as_ptr(),
                MB_OK | MB_ICONINFORMATION | MB_SETFOREGROUND | MB_TOPMOST,
            );
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain([0]).collect()
    }

    fn command_line(arguments: &[OsString]) -> Vec<u16> {
        let mut command_line = Vec::new();
        for (index, argument) in arguments.iter().enumerate() {
            if index != 0 {
                command_line.push(' ' as u16);
            }
            command_line.extend(quote(argument));
        }
        command_line.push(0);
        command_line
    }

    fn quote(argument: &OsString) -> Vec<u16> {
        quote_windows_argument(&argument.encode_wide().collect::<Vec<_>>())
    }
}

#[cfg(any(test, windows))]
pub(crate) fn quote_windows_argument(argument: &[u16]) -> Vec<u16> {
    if !argument.is_empty()
        && !argument
            .iter()
            .any(|&character| matches!(character, 0x09 | 0x20 | 0x22))
    {
        return argument.to_vec();
    }
    let mut quoted = vec!['"' as u16];
    let mut backslashes = 0;
    for &character in argument {
        if character == '\\' as u16 {
            backslashes += 1;
        } else if character == '"' as u16 {
            quoted.extend(std::iter::repeat_n('\\' as u16, backslashes * 2 + 1));
            quoted.push(character);
            backslashes = 0;
        } else {
            quoted.extend(std::iter::repeat_n('\\' as u16, backslashes));
            quoted.push(character);
            backslashes = 0;
        }
    }
    quoted.extend(std::iter::repeat_n('\\' as u16, backslashes * 2));
    quoted.push('"' as u16);
    quoted
}

fn download_artifact(
    artifact: &Artifact,
    destination: &Path,
    progress: Option<&Arc<SessionStore>>,
) -> Result<()> {
    let url = Url::parse(&artifact.url)?;
    if !is_secure_url(&url) {
        bail!("artifact URL must use HTTPS");
    }
    let response = secure_client().get(url).send()?.error_for_status()?;
    if response
        .content_length()
        .is_some_and(|length| length != artifact.size)
    {
        bail!("artifact Content-Length does not match manifest");
    }
    let mut reader = ProgressReader {
        reader: response,
        progress,
        downloaded: 0,
        reported: 0,
    };
    let file = File::create(destination)?;
    copy_verified(&mut reader, file, artifact)
}

struct ProgressReader<'a, R> {
    reader: R,
    progress: Option<&'a Arc<SessionStore>>,
    downloaded: u64,
    reported: u64,
}

impl<R: Read> Read for ProgressReader<'_, R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let count = self.reader.read(buffer)?;
        self.downloaded += count as u64;
        if count == 0 || self.downloaded.saturating_sub(self.reported) >= 65536 {
            if let Some(progress) = self.progress {
                progress
                    .change(|session| session.downloaded = self.downloaded)
                    .map_err(|error| io::Error::other(error.to_string()))?;
            }
            self.reported = self.downloaded;
        }
        Ok(count)
    }
}

pub(crate) fn copy_verified(
    reader: &mut impl Read,
    mut file: impl Write,
    artifact: &Artifact,
) -> Result<()> {
    let mut hash = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0u8; 8192];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > artifact.size || total > MAX_ARTIFACT_SIZE {
            bail!("artifact exceeds allowed size");
        }
        file.write_all(&buffer[..count])?;
        hash.update(&buffer[..count]);
    }
    if total != artifact.size {
        bail!("artifact size does not match manifest");
    }
    if format!("{:x}", hash.finalize()) != artifact.sha256.to_ascii_lowercase() {
        bail!("artifact SHA-256 does not match manifest");
    }
    Ok(())
}

fn verify_file(path: &Path, artifact: &Artifact) -> Result<()> {
    copy_verified(&mut File::open(path)?, io::sink(), artifact)
}

pub(crate) fn validate_artifact(artifact: &Artifact, platform: &str) -> Result<()> {
    if artifact.size == 0 || artifact.size > MAX_ARTIFACT_SIZE {
        bail!("artifact size is outside allowed bounds");
    }
    let url = Url::parse(&artifact.url)?;
    if !is_secure_url(&url) {
        bail!("artifact URL must use HTTPS");
    }
    if artifact.name.contains('/') || artifact.name.contains('\\') || artifact.name.is_empty() {
        bail!("artifact name must be a file name");
    }
    if !artifact.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) || artifact.sha256.len() != 64
    {
        bail!("artifact SHA-256 is invalid");
    }
    match platform {
        PLATFORM_LINUX if !artifact.name.ends_with(".AppImage") => {
            bail!("Linux artifact must be an AppImage")
        }
        PLATFORM_WINDOWS if !artifact.name.ends_with(".msi") => {
            bail!("Windows artifact must be an MSI")
        }
        _ => {}
    }
    Ok(())
}

fn secure_client() -> Client {
    Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .expect("valid update client")
}

fn is_secure_url(url: &Url) -> bool {
    url.scheme() == "https"
        || url
            .host_str()
            .is_some_and(|host| host == "127.0.0.1" || host == "localhost")
}

fn parse_version(version: &str) -> Result<Version> {
    Version::parse(&normalize_version(version)).map_err(Into::into)
}

fn normalize_version(version: &str) -> String {
    let version = version.trim_start_matches("catserver-v");
    if let Some((tag, hash)) = version.rsplit_once("-g")
        && !hash.is_empty()
        && let Some((tag, commits)) = tag.rsplit_once('-')
        && commits.bytes().all(|byte| byte.is_ascii_digit())
    {
        return format!("{tag}-{commits}");
    }
    version.to_owned()
}

fn platform() -> &'static str {
    if cfg!(windows) {
        PLATFORM_WINDOWS
    } else {
        PLATFORM_LINUX
    }
}

fn is_appimage(path: &Path) -> bool {
    std::env::var_os("APPIMAGE").is_some_and(|value| Path::new(&value) == path)
        && path
            .extension()
            .is_some_and(|extension| extension == "AppImage")
}

fn update_target() -> Result<PathBuf> {
    if cfg!(windows) {
        return Ok(std::env::current_exe()?);
    }
    std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "AppImage")
        })
        .context(
            "automatic update is only supported for APPIMAGE-backed executables; update manually",
        )
}

fn read_status(path: &Path) -> Result<UpdateStatus> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

pub(crate) fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    fs::create_dir_all(path.parent().context("state path has no parent")?)?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, serde_json::to_vec(value)?)?;
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(temporary, path)?;
    Ok(())
}

#[cfg(windows)]
fn windows_process_start_time(handle: windows_sys::Win32::Foundation::HANDLE) -> Result<u64> {
    use windows_sys::Win32::{Foundation::FILETIME, System::Threading::GetProcessTimes};

    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    if unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) } == 0 {
        return Err(io::Error::last_os_error().into());
    }
    Ok((u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime))
}

#[cfg(windows)]
fn update_helper_active(helper: &UpdateHelper) -> Option<bool> {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows_sys::Win32::{
        Foundation::{ERROR_INVALID_PARAMETER, WAIT_OBJECT_0, WAIT_TIMEOUT},
        System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
            WaitForSingleObject,
        },
    };

    let handle = unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
            0,
            helper.pid,
        )
    };
    if handle.is_null() {
        return (io::Error::last_os_error().raw_os_error() == Some(ERROR_INVALID_PARAMETER as i32))
            .then_some(false);
    }
    let process = unsafe { OwnedHandle::from_raw_handle(handle) };
    let handle = process.as_raw_handle();
    let started_at = windows_process_start_time(handle).ok()?;
    if started_at != helper.started_at {
        return Some(false);
    }
    match unsafe { WaitForSingleObject(handle, 0) } {
        WAIT_TIMEOUT => Some(true),
        WAIT_OBJECT_0 => Some(false),
        _ => None,
    }
}

#[cfg(all(test, windows))]
mod helper_process_tests {
    use super::*;
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    #[test]
    fn identifies_live_helper_and_reused_pid() {
        let pid = std::process::id();
        let started_at = windows_process_start_time(unsafe { GetCurrentProcess() }).unwrap();
        assert_eq!(
            update_helper_active(&UpdateHelper { pid, started_at }),
            Some(true)
        );
        assert_eq!(
            update_helper_active(&UpdateHelper {
                pid,
                started_at: started_at + 1,
            }),
            Some(false)
        );
    }

    #[test]
    fn reconciles_live_and_stale_install_on_windows_restart() {
        let data_dir = std::env::temp_dir().join(format!(
            "catserver-update-restart-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let service = || {
            UpdateService::with_data_dir(
                Url::parse("https://releases.example/manifest.json").unwrap(),
                "1.2.0",
                data_dir.clone(),
            )
            .unwrap()
        };
        let running = service();
        running
            .write_status(&UpdateStatus {
                state: UpdateState::Installing,
                available_version: Some("1.3.0".into()),
                diagnostic: None,
            })
            .unwrap();
        let helper = UpdateHelper {
            pid: std::process::id(),
            started_at: windows_process_start_time(unsafe { GetCurrentProcess() }).unwrap(),
        };
        write_json(&running.helper_path(), &helper).unwrap();
        assert_eq!(service().status().state, UpdateState::Installing);
        write_json(
            &running.helper_path(),
            &UpdateHelper {
                started_at: helper.started_at + 1,
                ..helper
            },
        )
        .unwrap();
        assert_eq!(service().status().state, UpdateState::Failed);
        fs::remove_dir_all(data_dir).unwrap();
    }
}

#[cfg(windows)]
fn wait_for_parent(parent_pid: u32) {
    while process_exists(parent_pid) {
        std::thread::sleep(Duration::from_millis(200));
    }
}

#[cfg(windows)]
fn process_exists(pid: u32) -> bool {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(access: u32, inherit: i32, process_id: u32) -> *mut std::ffi::c_void;
        fn GetExitCodeProcess(handle: *mut std::ffi::c_void, exit_code: *mut u32) -> i32;
        fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
    }
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const STILL_ACTIVE: u32 = 259;
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return false;
        }
        let mut exit_code = 0;
        let result = GetExitCodeProcess(handle, &mut exit_code) != 0 && exit_code == STILL_ACTIVE;
        CloseHandle(handle);
        result
    }
}

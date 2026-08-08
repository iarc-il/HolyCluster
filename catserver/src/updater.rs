#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

use anyhow::{Context, Result, bail};
use directories::ProjectDirs;
use reqwest::{Url, blocking::Client, redirect::Policy};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

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
    platform: &'static str,
    data_dir: PathBuf,
}

#[derive(Deserialize, Serialize)]
struct InstallPlan {
    current_executable: PathBuf,
    staged_artifact: PathBuf,
    artifact: Artifact,
    state_path: PathBuf,
    parent_pid: u32,
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
        Ok(Self {
            manifest_url,
            current_version: parse_running_version(current_version)?,
            platform: platform(),
            data_dir,
        })
    }

    pub fn status(&self) -> UpdateStatus {
        read_status(&self.state_path()).unwrap_or_default()
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
        let status = UpdateStatus {
            state: UpdateState::Failed,
            available_version: None,
            diagnostic: Some(diagnostic.into()),
        };
        self.write_status(&status)?;
        Ok(status)
    }

    pub fn check(&self) -> Result<UpdateStatus> {
        let result = self
            .fetch_manifest()
            .and_then(|manifest| self.accept_manifest(manifest));
        match result {
            Ok((version, _)) => {
                let status = UpdateStatus {
                    state: UpdateState::Available,
                    available_version: Some(version.to_string()),
                    diagnostic: None,
                };
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
        let (version, artifact) = self.accept_manifest(manifest)?;
        fs::create_dir_all(self.staging_dir())?;
        let staged = self
            .staging_dir()
            .join(format!("{}-{}.part", version, self.platform));
        let final_path = self
            .staging_dir()
            .join(format!("{}-{}", version, artifact.name));
        download_artifact(&artifact, &staged)?;
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
            })?,
        )?;
        Ok(status)
    }

    pub fn start_install(&self) -> Result<()> {
        let status = self.status();
        if status.state != UpdateState::Downloaded {
            bail!("an update must be downloaded before installation");
        }
        close_inherited_descriptors_on_exec()?;
        let executable = std::env::current_exe()?;
        let helper = Command::new(executable)
            .arg("--apply-update")
            .arg(self.plan_path())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .context("cannot start detached update helper")?;
        tracing::info!(pid = helper.id(), "Detached update helper started");
        self.write_status(&UpdateStatus {
            state: UpdateState::Installing,
            available_version: status.available_version,
            diagnostic: None,
        })
    }

    fn fetch_manifest(&self) -> Result<ReleaseManifest> {
        let response = secure_client()
            .get(self.manifest_url.clone())
            .send()?
            .error_for_status()?;
        Ok(serde_json::from_reader(response)?)
    }

    pub(crate) fn accept_manifest(&self, manifest: ReleaseManifest) -> Result<(Version, Artifact)> {
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
        if version <= self.current_version {
            bail!("release version is not newer than the running catserver");
        }
        let mut artifact = release.artifact.clone();
        artifact.url = self.manifest_url.join(&artifact.url)?.to_string();
        validate_artifact(&artifact, self.platform)?;
        Ok((version, artifact))
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
    wait_for_parent(plan.parent_pid);
    tracing::info!("Parent catserver exited; applying update");
    let result = if cfg!(windows) {
        install_windows(&plan)
    } else {
        install_linux(&plan)
    };
    let status = match &result {
        Ok(()) => UpdateStatus {
            state: UpdateState::Installed,
            available_version: None,
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
    } else {
        tracing::info!("Update helper completed successfully");
    }
    write_json(&plan.state_path, &status).context("cannot persist update helper status")?;
    result
}

fn install_linux(plan: &InstallPlan) -> Result<()> {
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
    if let Err(error) = Command::new(&plan.current_executable).spawn() {
        let _ = fs::rename(&plan.current_executable, &activation);
        let _ = fs::rename(&backup, &plan.current_executable);
        let _ = fs::remove_file(&activation);
        return Err(error).context("cannot relaunch updated AppImage; previous version restored");
    }
    Ok(())
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

fn install_windows(plan: &InstallPlan) -> Result<()> {
    if platform() != PLATFORM_WINDOWS {
        bail!("Windows installer received on unsupported platform");
    }
    verify_file(&plan.staged_artifact, &plan.artifact)?;
    let status = windows_installer_command(&plan.staged_artifact).status()?;
    if !status.success() {
        bail!("MSI installer exited with {status}; MSI rollback is not guaranteed");
    }
    Command::new(&plan.current_executable).spawn()?;
    Ok(())
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
        if unsafe { libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC) } == -1 {
            return Err(io::Error::last_os_error().into());
        }
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
pub(crate) fn close_inherited_descriptors_on_exec() -> Result<()> {
    Ok(())
}

pub(crate) fn windows_installer_command(msi: &Path) -> Command {
    let mut command = Command::new("msiexec.exe");
    command.args(["/i"]).arg(msi).args(["/qn", "/norestart"]);
    command
}

fn download_artifact(artifact: &Artifact, destination: &Path) -> Result<()> {
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
    let mut response = response;
    let file = File::create(destination)?;
    copy_verified(&mut response, file, artifact)
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
    Version::parse(version.trim_start_matches("catserver-v")).map_err(Into::into)
}
pub(crate) fn parse_running_version(version: &str) -> Result<Version> {
    let version = version.trim_start_matches("catserver-v");
    let version = version
        .rsplit_once("-g")
        .and_then(|(tag, hash)| {
            (!hash.is_empty())
                .then_some(tag)
                .and_then(|tag| tag.rsplit_once('-'))
                .filter(|(_, commits)| commits.bytes().all(|byte| byte.is_ascii_digit()))
                .map(|(tag, _)| tag)
        })
        .unwrap_or(version);
    Version::parse(version).map_err(Into::into)
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
fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
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
fn wait_for_parent(parent_pid: u32) {
    while process_exists(parent_pid) {
        std::thread::sleep(Duration::from_millis(200));
    }
}
#[cfg(unix)]
fn process_exists(pid: u32) -> bool {
    Path::new("/proc").join(pid.to_string()).exists()
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

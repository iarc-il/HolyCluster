use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

use thiserror::Error;

use crate::{
    archive::{ArchiveError, ArchiveRequest, NetworkAccess, acquire_archive, extract_archive},
    artifact::{ArtifactError, stage_windows_artifacts},
    libtool::{
        LibtoolError, normalize_libusb_dependency_paths, sanitize_installed_metadata_paths,
        validate_windows_naming,
    },
    plan::{BuildPlan, BuildPlanError, HAMLIB_SHA256, HAMLIB_VERSION, LinkMode},
    source::{SourceOverrideError, local_source},
    target_dir::resolve_cargo_target_dir,
    toolchain::{MINGW_TOOLCHAIN, ToolchainError, validate_mingw_toolchain},
};

#[derive(Debug, Error)]
pub enum SupportError {
    #[error("missing Cargo build variable {0}")]
    MissingEnvironment(&'static str),
    #[error(transparent)]
    Archive(#[from] ArchiveError),
    #[error(transparent)]
    Plan(#[from] BuildPlanError),
    #[error(transparent)]
    Artifact(#[from] ArtifactError),
    #[error(transparent)]
    Libtool(#[from] LibtoolError),
    #[error(transparent)]
    Toolchain(#[from] ToolchainError),
    #[error(transparent)]
    SourceOverride(#[from] SourceOverrideError),
    #[error("Windows Hamlib builds require target libusb; set {0}")]
    MissingWindowsLibusb(&'static str),
    #[error("failed to run {program}: {source}")]
    Command {
        program: &'static str,
        source: std::io::Error,
    },
    #[error("{program} exited with status {status}")]
    CommandFailed {
        program: &'static str,
        status: std::process::ExitStatus,
    },
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

pub fn build_from_environment() -> Result<(), SupportError> {
    println!("cargo:rerun-if-env-changed=HAMLIB_SOURCE_ARCHIVE");
    println!("cargo:rerun-if-env-changed=HAMLIB_SOURCE_DIR");
    println!("cargo:rerun-if-env-changed=HAMLIB_SOURCE_NETWORK");
    println!("cargo:rerun-if-env-changed=HAMLIB_LIBUSB_INCLUDE_DIR");
    println!("cargo:rerun-if-env-changed=HAMLIB_LIBUSB_LIB_DIR");
    let out_dir = variable_path("OUT_DIR")?;
    let target = env::var("TARGET").map_err(|_| SupportError::MissingEnvironment("TARGET"))?;
    let plan = BuildPlan::for_target(&target)?;
    let source_override = env::var_os("HAMLIB_SOURCE_DIR").map(PathBuf::from);
    let source = match local_source(source_override.as_deref())? {
        Some(source) => {
            println!("cargo:rerun-if-changed={}", source.display());
            source
        }
        None => pinned_source(&out_dir, &target)?,
    };
    let prefix = out_dir.join("prefix");
    run_configure(&source, &plan, &prefix)?;
    run_make(&source)?;
    run_make_install(&source)?;
    if plan.is_windows() {
        let libusb_lib = required_env_path("HAMLIB_LIBUSB_LIB_DIR")?;
        let metadata_path = prefix.join("lib/libhamlib.la");
        let metadata = fs::read_to_string(&metadata_path)?;
        let metadata = normalize_libusb_dependency_paths(&metadata, &libusb_lib)?;
        fs::write(
            metadata_path,
            sanitize_installed_metadata_paths(&metadata, &prefix),
        )?;
    }
    let mut metadata = plan.metadata(&prefix);
    if plan.is_windows() {
        let (runtime_library, import_library) = stage_windows_artifacts(&source, &prefix)?;
        metadata.runtime_library = Some(runtime_library);
        metadata.import_library = Some(import_library);
    }
    emit_metadata(&metadata, &prefix);
    Ok(())
}

fn pinned_source(out_dir: &Path, target: &str) -> Result<PathBuf, SupportError> {
    let cache_path = cargo_target_dir(out_dir, target)?
        .join("hamlib-src")
        .join(HAMLIB_VERSION)
        .join(HAMLIB_SHA256)
        .join("hamlib-4.7.2.tar.gz");
    let override_archive = env::var_os("HAMLIB_SOURCE_ARCHIVE").map(PathBuf::from);
    let network = match env::var("HAMLIB_SOURCE_NETWORK").as_deref() {
        Ok("0") => NetworkAccess::Disabled,
        Ok(_) | Err(_) => NetworkAccess::Enabled,
    };
    let archive = acquire_archive(&ArchiveRequest::official(
        cache_path,
        override_archive,
        network,
    ))?;
    let extraction = out_dir.join("source");
    if extraction.exists() {
        fs::remove_dir_all(&extraction)?;
    }
    extract_archive(&archive, &extraction, "hamlib-4.7.2").map_err(Into::into)
}

fn variable_path(name: &'static str) -> Result<PathBuf, SupportError> {
    env::var_os(name)
        .map(PathBuf::from)
        .ok_or(SupportError::MissingEnvironment(name))
}

fn cargo_target_dir(out_dir: &Path, target: &str) -> Result<PathBuf, SupportError> {
    let configured = env::var_os("CARGO_TARGET_DIR").map(PathBuf::from);
    let current_dir = env::current_dir()?;
    resolve_cargo_target_dir(out_dir, target, configured.as_deref(), &current_dir)
        .map_err(SupportError::MissingEnvironment)
}

fn run_configure(source: &Path, plan: &BuildPlan, prefix: &Path) -> Result<(), SupportError> {
    let mut command = Command::new("sh");
    command
        .current_dir(source)
        .arg("./configure")
        .args(plan.configure_args(prefix));
    if plan.is_windows() {
        let libusb_include = required_env_path("HAMLIB_LIBUSB_INCLUDE_DIR")?;
        let libusb_lib = required_env_path("HAMLIB_LIBUSB_LIB_DIR")?;
        command.envs(MINGW_TOOLCHAIN);
        command.env("CPPFLAGS", format!("-I{}", libusb_include.display()));
        command.env("LDFLAGS", format!("-L{}", libusb_lib.display()));
        command.env("PKG_CONFIG", "pkg-config");
        command.env("PKG_CONFIG_LIBDIR", libusb_lib.join("pkgconfig"));
        command.env("PKG_CONFIG_PATH", "");
    }
    run("sh", &mut command)?;
    if plan.is_windows() {
        validate_mingw_toolchain(&fs::read_to_string(source.join("config.log"))?)?;
        validate_windows_naming(&fs::read_to_string(source.join("libtool"))?)?;
    }
    Ok(())
}

fn required_env_path(name: &'static str) -> Result<PathBuf, SupportError> {
    env::var_os(name)
        .map(PathBuf::from)
        .ok_or(SupportError::MissingWindowsLibusb(name))
}

fn run_make(source: &Path) -> Result<(), SupportError> {
    let jobs = match env::var("NUM_JOBS") {
        Ok(jobs) => jobs,
        Err(_) => "1".to_owned(),
    };
    run(
        "make",
        Command::new("make").current_dir(source).arg("-j").arg(jobs),
    )
}

fn run_make_install(source: &Path) -> Result<(), SupportError> {
    run(
        "make",
        Command::new("make")
            .current_dir(source)
            .arg("-j")
            .arg("1")
            .arg("install"),
    )
}

fn run(program: &'static str, command: &mut Command) -> Result<(), SupportError> {
    let status = command
        .status()
        .map_err(|source| SupportError::Command { program, source })?;
    if status.success() {
        Ok(())
    } else {
        Err(SupportError::CommandFailed { program, status })
    }
}

fn emit_metadata(metadata: &crate::plan::BuildMetadata, prefix: &Path) {
    println!("cargo:root={}", prefix.display());
    println!("cargo:include={}", metadata.include_dir.display());
    println!("cargo:libdir={}", metadata.lib_dir.display());
    println!("cargo:runtimedir={}", metadata.runtime_dir.display());
    println!("cargo:version={}", metadata.version);
    if let Some(runtime_library) = &metadata.runtime_library {
        println!("cargo:runtime_library={}", runtime_library.display());
    } else {
        println!("cargo:library_file={}", metadata.library_file);
    }
    if let Some(import_library) = &metadata.import_library {
        println!("cargo:import_library={}", import_library.display());
    }
    match metadata.link_mode {
        LinkMode::Static => println!(
            "cargo:rustc-link-search=native={}",
            metadata.lib_dir.display()
        ),
        LinkMode::Shared => println!(
            "cargo:rustc-link-search=native={}",
            metadata.lib_dir.display()
        ),
    }
}

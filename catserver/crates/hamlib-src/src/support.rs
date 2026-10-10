use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

use thiserror::Error;

use crate::{
    archive::{ArchiveError, ArchiveRequest, NetworkAccess, acquire_archive, extract_archive},
    package::{HAMLIB, LIBUSB, SourcePackage},
    plan::{BuildPlan, BuildPlanError, libusb_metadata},
    size_flags::native_size_flags,
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
    Toolchain(#[from] ToolchainError),
    #[error(transparent)]
    SourceOverride(#[from] SourceOverrideError),
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
    #[error("libusb static archive is invalid: {0}")]
    InvalidLibusbArchive(PathBuf),
}

pub fn build_from_environment() -> Result<(), SupportError> {
    for input in ["build.rs", "src", "patches"] {
        println!("cargo:rerun-if-changed={input}");
    }
    println!("cargo:rerun-if-env-changed=HAMLIB_SOURCE_ARCHIVE");
    println!("cargo:rerun-if-env-changed=HAMLIB_SOURCE_DIR");
    println!("cargo:rerun-if-env-changed=HAMLIB_SOURCE_NETWORK");
    // Configure and make inherit these inputs, including host toolchain
    // overrides. A changed input must rebuild Cargo-managed native objects.
    for variable in [
        "PROFILE",
        "CC",
        "CXX",
        "CPP",
        "LD",
        "AR",
        "RANLIB",
        "DLLTOOL",
        "WINDRES",
        "CFLAGS",
        "CXXFLAGS",
        "CPPFLAGS",
        "LDFLAGS",
        "LIBS",
        "MAKE",
        "MAKEFLAGS",
        "MFLAGS",
        "GNUMAKEFLAGS",
        "PATH",
        "PKG_CONFIG",
        "PKG_CONFIG_PATH",
        "PKG_CONFIG_LIBDIR",
        "PKG_CONFIG_SYSROOT_DIR",
        "CONFIG_SITE",
    ] {
        println!("cargo:rerun-if-env-changed={variable}");
    }
    let out_dir = variable_path("OUT_DIR")?;
    let target = env::var("TARGET").map_err(|_| SupportError::MissingEnvironment("TARGET"))?;
    let plan = BuildPlan::for_target(&target)?;
    let source_override = env::var_os("HAMLIB_SOURCE_DIR").map(PathBuf::from);
    let source = match local_source(source_override.as_deref())? {
        Some(source) => {
            println!("cargo:rerun-if-changed={}", source.display());
            crate::diagnostic_patch::validate_override(&source)?;
            source
        }
        None => pinned_source(&out_dir, &target, HAMLIB)?,
    };
    if source_override.is_none() {
        crate::diagnostic_patch::apply(&source)?;
    }
    let prefix = out_dir.join("prefix");
    let libusb = plan
        .is_windows()
        .then(|| build_libusb(&out_dir, &target))
        .transpose()?;
    run_configure(
        &source,
        &plan,
        &prefix,
        libusb.as_deref(),
        source_override.is_none(),
    )?;
    if source_override.is_some() {
        // Validated headers alone cannot establish that caller-owned objects are
        // patched. Rebuild all native objects before installing the archive.
        run(
            "make",
            Command::new("make").current_dir(&source).arg("clean"),
        )?;
    }
    run_make(&source)?;
    run_make_install(&source)?;
    emit_metadata(&plan.metadata(&prefix), &prefix, libusb.as_deref());
    Ok(())
}

fn pinned_source(
    out_dir: &Path,
    target: &str,
    package: SourcePackage,
) -> Result<PathBuf, SupportError> {
    let cache_path = cargo_target_dir(out_dir, target)?
        .join("hamlib-src")
        .join(package.name)
        .join(package.version)
        .join(package.sha256)
        .join(package.url.rsplit('/').next().unwrap_or(package.name));
    let override_archive = (package == HAMLIB)
        .then(|| env::var_os("HAMLIB_SOURCE_ARCHIVE").map(PathBuf::from))
        .flatten();
    let network = match env::var("HAMLIB_SOURCE_NETWORK").as_deref() {
        Ok("0") => NetworkAccess::Disabled,
        Ok(_) | Err(_) => NetworkAccess::Enabled,
    };
    let archive = acquire_archive(&ArchiveRequest {
        cache_path,
        override_archive,
        expected_sha256: package.sha256.to_owned(),
        network,
        url: package.url.to_owned(),
    })?;
    println!("cargo:rerun-if-changed={}", archive.display());
    let extraction = out_dir.join(package.name).join("source");
    if extraction.exists() {
        fs::remove_dir_all(&extraction)?;
    }
    extract_archive(&archive, &extraction, package.archive_root).map_err(Into::into)
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

fn build_libusb(out_dir: &Path, target: &str) -> Result<PathBuf, SupportError> {
    let source = pinned_source(out_dir, target, LIBUSB)?;
    let prefix = out_dir.join("libusb");
    let mut command = Command::new("sh");
    command.current_dir(&source).arg("./configure").args([
        "--host=x86_64-w64-mingw32".to_owned(),
        format!("--prefix={}", prefix.display()),
        "--disable-shared".to_owned(),
        "--enable-static".to_owned(),
    ]);
    // Keep libusb's own compiler settings. GCC's -Os triggers an upstream
    // -Werror=maybe-uninitialized failure in libusb 1.0.30 on MinGW.
    command.envs(MINGW_TOOLCHAIN);
    run("sh", &mut command)?;
    validate_mingw_toolchain(&fs::read_to_string(source.join("config.log"))?)?;
    run_make(&source)?;
    run_make_install(&source)?;
    let artifact = libusb_metadata(&prefix).artifact;
    if !is_static_archive(&artifact)? {
        return Err(SupportError::InvalidLibusbArchive(artifact));
    }
    Ok(prefix)
}

fn run_configure(
    source: &Path,
    plan: &BuildPlan,
    prefix: &Path,
    libusb: Option<&Path>,
    managed_source: bool,
) -> Result<(), SupportError> {
    let mut command = Command::new("sh");
    command
        .current_dir(source)
        .arg("./configure")
        .args(plan.configure_args(prefix));
    if plan.is_windows() {
        let libusb = libusb.expect("Windows builds create libusb first");
        command.envs(MINGW_TOOLCHAIN);
        append_environment_flag(
            &mut command,
            "CPPFLAGS",
            &format!("-I{}", libusb.join("include").display()),
        );
        append_environment_flag(
            &mut command,
            "LDFLAGS",
            &format!("-L{}", libusb.join("lib").display()),
        );
        command.env("PKG_CONFIG", "pkg-config");
        command.env("PKG_CONFIG_LIBDIR", libusb.join("lib/pkgconfig"));
        command.env("PKG_CONFIG_PATH", "");
    }
    // Only change flags for fresh, Cargo-managed source trees. Reconfiguring a
    // caller's existing HAMLIB_SOURCE_DIR does not rebuild its cached objects.
    if managed_source {
        configure_native_size_flags(&mut command, plan.is_windows());
    }
    run("sh", &mut command)?;
    if plan.is_windows() {
        validate_mingw_toolchain(&fs::read_to_string(source.join("config.log"))?)?;
    }
    Ok(())
}

fn append_environment_flag(command: &mut Command, variable: &str, flag: &str) {
    let mut flags = env::var_os(variable).unwrap_or_default();
    if !flags.is_empty() {
        flags.push(" ");
    }
    flags.push(flag);
    command.env(variable, flags);
}

fn configure_native_size_flags(command: &mut Command, windows: bool) {
    let release = env::var("PROFILE").as_deref() == Ok("release");
    for variable in ["CFLAGS", "CXXFLAGS"] {
        if release {
            let caller_flags = env::var_os(variable).unwrap_or_default();
            command.env(variable, native_size_flags(release, windows, &caller_flags));
        }
    }
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

fn emit_metadata(metadata: &crate::plan::BuildMetadata, prefix: &Path, libusb: Option<&Path>) {
    println!("cargo:root={}", prefix.display());
    println!("cargo:include={}", metadata.include_dir.display());
    println!("cargo:libdir={}", metadata.lib_dir.display());
    println!("cargo:version={}", metadata.version);
    println!("cargo:library_file={}", metadata.library_file);
    println!(
        "cargo:rustc-link-search=native={}",
        metadata.lib_dir.display()
    );
    if let Some(libusb) = libusb {
        let metadata = libusb_metadata(libusb);
        println!("cargo:libusb_include={}", metadata.include_dir.display());
        println!("cargo:libusb_libdir={}", metadata.lib_dir.display());
        println!("cargo:libusb_artifact={}", metadata.artifact.display());
    }
}

fn is_static_archive(path: &Path) -> Result<bool, std::io::Error> {
    let bytes = fs::read(path)?;
    Ok(bytes.starts_with(b"!<arch>\n"))
}

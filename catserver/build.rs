use {
    std::{env, fs, io, path::PathBuf, process::Command},
    winresource::{VersionInfo, WindowsResource},
};

fn main() -> io::Result<()> {
    println!("cargo:rerun-if-changed=sentry_dsn.txt");
    println!("cargo:rerun-if-env-changed=CATSERVER_SENTRY_ENVIRONMENT");
    println!("cargo:rerun-if-env-changed=CATSERVER_VERSION");

    let version = release_version();
    println!("cargo:rustc-env=VERSION={version}");

    if env::var_os("CARGO_CFG_WINDOWS").is_some() {
        println!("cargo:rerun-if-changed=wix/icon.ico");
        compile_windows_resource(&version)?;
    }

    let sentry_environment =
        env::var("CATSERVER_SENTRY_ENVIRONMENT").unwrap_or_else(|_| "dev".into());
    if !matches!(sentry_environment.as_str(), "dev" | "prod") {
        panic!("Invalid Sentry environment: {sentry_environment}");
    }
    println!("cargo:rustc-env=CATSERVER_SENTRY_ENVIRONMENT={sentry_environment}");
    let sentry_dsn_path =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("sentry_dsn.txt");
    let sentry_dsn = fs::read_to_string(sentry_dsn_path)?.trim().to_owned();
    if sentry_dsn.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "sentry_dsn.txt is empty",
        ));
    }
    println!("cargo:rustc-env=CATSERVER_SENTRY_DSN={sentry_dsn}");

    Ok(())
}

fn release_version() -> String {
    if let Ok(version) = env::var("CATSERVER_VERSION") {
        validate_version(&version);
        return version;
    }
    for path in ["HEAD", "packed-refs", "refs/tags"] {
        let output = Command::new("git")
            .args(["rev-parse", "--git-path", path])
            .output()
            .unwrap();
        if output.status.success() {
            println!(
                "cargo:rerun-if-changed={}",
                String::from_utf8(output.stdout).unwrap().trim()
            );
        }
    }
    let symbolic_ref = Command::new("git")
        .args(["symbolic-ref", "-q", "HEAD"])
        .output()
        .unwrap();
    if symbolic_ref.status.success() {
        let reference = String::from_utf8(symbolic_ref.stdout).unwrap();
        let output = Command::new("git")
            .args(["rev-parse", "--git-path", reference.trim()])
            .output()
            .unwrap();
        if output.status.success() {
            println!(
                "cargo:rerun-if-changed={}",
                String::from_utf8(output.stdout).unwrap().trim()
            );
        }
    }
    let output = Command::new("git")
        .args(["describe", "--match", "catserver-v*"])
        .output()
        .unwrap();
    if !output.status.success() || output.stdout.is_empty() {
        panic!(
            "No matching git version tag found:\n{}",
            String::from_utf8(output.stderr).unwrap()
        );
    }
    let version = String::from_utf8(output.stdout).unwrap();
    let version = version.trim().to_owned();
    validate_version(&version);
    version
}

fn validate_version(version: &str) {
    if !version.starts_with("catserver-v") {
        panic!("Invalid catserver release: {version}");
    }
}

fn compile_windows_resource(version: &str) -> io::Result<()> {
    let release = version
        .strip_prefix("catserver-v")
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid release version"))?;
    let mut release_parts = release.split('-');
    let base = semver::Version::parse(release_parts.next().unwrap())
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let commit_count = release_parts
        .next()
        .map(str::parse::<u64>)
        .transpose()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?
        .unwrap_or(0);
    if [base.major, base.minor, base.patch, commit_count]
        .into_iter()
        .any(|part| part > u16::MAX.into())
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "release version exceeds Windows version fields",
        ));
    }
    let numeric_version = base.major << 48 | base.minor << 32 | base.patch << 16 | commit_count;
    WindowsResource::new()
        .set_icon("wix/icon.ico")
        .set("FileVersion", release)
        .set("ProductVersion", release)
        .set_version_info(VersionInfo::FILEVERSION, numeric_version)
        .set_version_info(VersionInfo::PRODUCTVERSION, numeric_version)
        .compile()
}

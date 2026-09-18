use {
    std::{env, fs, io, path::PathBuf, process::Command},
    winresource::WindowsResource,
};

fn main() -> io::Result<()> {
    println!("cargo:rerun-if-changed=sentry_dsn.txt");
    println!("cargo:rerun-if-env-changed=CATSERVER_SENTRY_ENVIRONMENT");
    println!("cargo:rerun-if-env-changed=CATSERVER_VERSION");

    let version = release_version();
    println!("cargo:rustc-env=VERSION={version}");

    if env::var_os("CARGO_CFG_WINDOWS").is_some() {
        println!("cargo:rerun-if-changed=wix/icon.ico");
        let resource = write_windows_resource(&version)?;
        WindowsResource::new()
            .set_resource_file(resource.to_str().unwrap())
            .compile()?;
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

fn write_windows_resource(version: &str) -> io::Result<PathBuf> {
    let release = version
        .strip_prefix("catserver-v")
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid release version"))?;
    let mut release_parts = release.split('-');
    let base = release_parts.next().unwrap();
    let commit_count = release_parts
        .next()
        .map(str::parse::<u16>)
        .transpose()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?
        .unwrap_or(0);
    let numbers = base
        .split('.')
        .map(str::parse::<u16>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let [major, minor, patch] = numbers.as_slice() else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "release version must contain three numbers",
        ));
    };
    let contents = format!(
        r#"#pragma code_page(65001)
1 VERSIONINFO
FILETYPE 0x1
FILESUBTYPE 0x0
FILEFLAGSMASK 0x3f
FILEFLAGS 0x0
FILEOS 0x40004
FILEVERSION {major}, {minor}, {patch}, {commit_count}
PRODUCTVERSION {major}, {minor}, {patch}, {commit_count}
{{
BLOCK "StringFileInfo"
{{
BLOCK "000004b0"
{{
VALUE "FileDescription", "catserver"
VALUE "FileVersion", "{release}"
VALUE "ProductName", "catserver"
VALUE "ProductVersion", "{release}"
}}
}}
BLOCK "VarFileInfo" {{
VALUE "Translation", 0x0, 0x04b0
}}
}}
1 ICON "wix/icon.ico"
"#
    );
    let path = PathBuf::from(env::var("OUT_DIR").unwrap()).join("resource.rc");
    fs::write(&path, contents)?;
    Ok(path)
}

use {
    std::{env, fs, io, path::PathBuf, process::Command},
    winresource::WindowsResource,
};

fn main() -> io::Result<()> {
    println!("cargo:rerun-if-changed=sentry_dsn.txt");
    println!("cargo:rerun-if-env-changed=CATSERVER_SENTRY_ENVIRONMENT");
    if env::var_os("CARGO_CFG_WINDOWS").is_some() {
        WindowsResource::new().set_icon("wix/icon.ico").compile()?;
    }

    let output = Command::new("git")
        .args(["describe", "--match", "catserver-v*"])
        .output()
        .unwrap();
    if output.stdout.is_empty() {
        panic!(
            "No matching git version tag found:\n{}",
            String::from_utf8(output.stderr).unwrap()
        );
    }
    let version = String::from_utf8(output.stdout).unwrap();
    let version = version.trim();
    if !version.starts_with("catserver-v") {
        panic!("Invalid catserver release: {version}");
    }
    println!("cargo:rustc-env=VERSION={version}");
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

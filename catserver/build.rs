use {
    std::{env, io, process::Command},
    winresource::WindowsResource,
};

fn main() -> io::Result<()> {
    println!("cargo:rerun-if-env-changed=CATSERVER_SENTRY_DSN");
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
        env::var("CATSERVER_SENTRY_ENVIRONMENT").unwrap_or_else(|_| "development".into());
    if !matches!(sentry_environment.as_str(), "development" | "production") {
        panic!("Invalid Sentry environment: {sentry_environment}");
    }
    println!("cargo:rustc-env=CATSERVER_SENTRY_ENVIRONMENT={sentry_environment}");
    println!(
        "cargo:rustc-env=CATSERVER_SENTRY_DSN={}",
        env::var("CATSERVER_SENTRY_DSN").unwrap_or_default()
    );

    Ok(())
}

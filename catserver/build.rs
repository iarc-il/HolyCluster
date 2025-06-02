use {
    std::{env, io, process::Command},
    winresource::WindowsResource,
};

fn main() -> io::Result<()> {
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
    println!("cargo:rustc-env=VERSION={version}");

    let dev_server_var = "DEV_SERVER";

    println!("cargo:rerun-if-env-changed={dev_server_var}");
    if env::var("DEV_SERVER").ok() == Some("1".to_string()) {
        println!("cargo:rustc-env={dev_server_var}=1");
    } else {
        println!("cargo:rustc-env={dev_server_var}=0");
    }

    Ok(())
}

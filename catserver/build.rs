use std::{env, io, path::Path};
use winresource::WindowsResource;

fn main() -> io::Result<()> {
    if env::var_os("CARGO_CFG_WINDOWS").is_some() {
        let icon_path = "wix/icon.ico";
        if Path::new(icon_path).exists() {
            WindowsResource::new().set_icon(icon_path).compile()?;
        } else {
            println!("cargo:warning=Icon not found at: {:?}", icon_path);
        }
    }
    Ok(())
}

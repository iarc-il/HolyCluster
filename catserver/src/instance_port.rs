use std::{
    fs, io,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use directories::ProjectDirs;

pub fn path() -> Result<PathBuf> {
    Ok(ProjectDirs::from("org", "IARC", "HolyCluster")
        .context("cannot determine instance port directory")?
        .data_local_dir()
        .join("instance-port"))
}

pub fn publish(path: &Path, port: u16) -> Result<()> {
    if port == 0 {
        bail!("cannot publish an unbound port");
    }
    fs::create_dir_all(path.parent().context("instance port path has no parent")?)?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, port.to_string())?;
    #[cfg(windows)]
    clear(path)?;
    fs::rename(temporary, path)?;
    Ok(())
}

pub fn read(path: &Path) -> Result<u16> {
    let port = fs::read_to_string(path)?.trim().parse::<u16>()?;
    if port == 0 {
        bail!("invalid instance port");
    }
    Ok(port)
}

pub fn clear(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

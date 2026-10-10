use std::{
    fs,
    path::{Path, PathBuf},
};

use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SourceOverrideError {
    #[error("Hamlib source override is not a directory: {0}")]
    NotDirectory(PathBuf),
    #[error("Hamlib source override lacks generated configure: {0}")]
    MissingConfigure(PathBuf),
}

pub fn local_source(path: Option<&Path>) -> Result<Option<PathBuf>, SourceOverrideError> {
    let Some(path) = path else {
        return Ok(None);
    };
    let path =
        fs::canonicalize(path).map_err(|_| SourceOverrideError::NotDirectory(path.into()))?;
    if !path.is_dir() {
        return Err(SourceOverrideError::NotDirectory(path));
    }
    if !path.join("configure").is_file() {
        return Err(SourceOverrideError::MissingConfigure(path));
    }
    Ok(Some(path))
}

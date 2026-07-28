use std::{
    fs, io,
    path::{Path, PathBuf},
};

use thiserror::Error;

use crate::libtool::parse_libtool_metadata;

#[derive(Debug, Error)]
pub enum ArtifactError {
    #[error("missing Windows Hamlib runtime DLL under {0}")]
    MissingRuntime(PathBuf),
    #[error("missing Windows Hamlib import library under {0}")]
    MissingImportLibrary(PathBuf),
    #[error("Windows Hamlib runtime {0} is not a PE32+ DLL")]
    InvalidRuntime(PathBuf),
    #[error("Windows Hamlib import library {0} is not an ar archive")]
    InvalidImportLibrary(PathBuf),
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
}

pub fn is_ar_archive(bytes: &[u8]) -> bool {
    bytes.starts_with(b"!<arch>\n")
}

pub fn is_pe32_plus(bytes: &[u8]) -> bool {
    if bytes.len() < 0x9a || &bytes[..2] != b"MZ" {
        return false;
    }
    let offset = u32::from_le_bytes([bytes[0x3c], bytes[0x3d], bytes[0x3e], bytes[0x3f]]) as usize;
    bytes.get(offset..offset + 4) == Some(b"PE\0\0")
        && bytes.get(offset + 24..offset + 26) == Some(&0x20b_u16.to_le_bytes())
}

pub fn stage_windows_artifacts(
    source: &Path,
    prefix: &Path,
) -> Result<(PathBuf, PathBuf), ArtifactError> {
    let metadata = parse_libtool_metadata(&fs::read_to_string(prefix.join("lib/libhamlib.la"))?)
        .map_err(|_| ArtifactError::MissingImportLibrary(prefix.join("lib")))?;
    let runtime_name = Path::new(metadata.runtime_name())
        .file_name()
        .ok_or_else(|| ArtifactError::MissingRuntime(source.join("src/.libs")))?;
    let runtime = source.join("src/.libs").join(runtime_name);
    let import_library = prefix.join("lib").join(metadata.import_name());
    if !runtime.exists() {
        return Err(ArtifactError::MissingRuntime(runtime));
    }
    if !import_library.exists() {
        return Err(ArtifactError::MissingImportLibrary(import_library));
    }
    let staged_runtime = prefix.join("bin").join(runtime_name);
    fs::create_dir_all(prefix.join("bin"))?;
    fs::copy(&runtime, &staged_runtime)?;
    if !is_pe32_plus(&fs::read(&staged_runtime)?) {
        return Err(ArtifactError::InvalidRuntime(staged_runtime));
    }
    if !is_ar_archive(&fs::read(&import_library)?) {
        return Err(ArtifactError::InvalidImportLibrary(import_library));
    }
    Ok((staged_runtime, import_library))
}

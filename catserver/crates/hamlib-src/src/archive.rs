use {
    flate2::read::GzDecoder,
    sha2::{Digest, Sha256},
    std::{
        fs::{self, File, FileTimes},
        io::{self, Read},
        path::{Component, Path, PathBuf},
        time::Duration,
    },
    tar::Archive,
    thiserror::Error,
};

use crate::plan::{HAMLIB_ARCHIVE_URL, HAMLIB_SHA256};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkAccess {
    Enabled,
    Disabled,
}

#[derive(Debug, Clone)]
pub struct ArchiveRequest {
    pub cache_path: PathBuf,
    pub override_archive: Option<PathBuf>,
    pub expected_sha256: String,
    pub network: NetworkAccess,
    pub url: String,
}

#[derive(Debug, Error)]
pub enum ArchiveError {
    #[error("the Hamlib archive is unavailable in {0} while network access is disabled")]
    OfflineCacheMiss(String),
    #[error("the archive at {path} has SHA-256 {actual}, expected {expected}")]
    HashMismatch {
        path: PathBuf,
        actual: String,
        expected: String,
    },
    #[error("failed to download {url}: {message}")]
    Download { url: String, message: String },
    #[error("archive entry {0} is not a safe relative path")]
    Traversal(PathBuf),
    #[error("archive entry {0} is not a regular file or directory")]
    UnsupportedEntry(PathBuf),
    #[error("archive does not contain the expected top-level source directory {0}")]
    MissingSourceRoot(String),
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
}

impl ArchiveRequest {
    pub fn official(
        cache_path: PathBuf,
        override_archive: Option<PathBuf>,
        network: NetworkAccess,
    ) -> Self {
        Self {
            cache_path,
            override_archive,
            expected_sha256: HAMLIB_SHA256.to_owned(),
            network,
            url: HAMLIB_ARCHIVE_URL.to_owned(),
        }
    }
}

pub fn acquire_archive(request: &ArchiveRequest) -> Result<PathBuf, ArchiveError> {
    if let Some(path) = &request.override_archive {
        verify_sha256(path, &request.expected_sha256)?;
        return Ok(path.clone());
    }
    if request.cache_path.exists() {
        match verify_sha256(&request.cache_path, &request.expected_sha256) {
            Ok(()) => return Ok(request.cache_path.clone()),
            Err(ArchiveError::HashMismatch { .. }) => fs::remove_file(&request.cache_path)?,
            Err(error) => return Err(error),
        }
    }
    let partial_path = request.cache_path.with_extension("partial");
    if partial_path.exists() {
        fs::remove_file(partial_path)?;
    }
    match request.network {
        NetworkAccess::Disabled => Err(ArchiveError::OfflineCacheMiss(
            request.cache_path.display().to_string(),
        )),
        NetworkAccess::Enabled => download_verified(request),
    }
}

pub fn extract_archive(
    archive_path: &Path,
    destination: &Path,
    root_name: &str,
) -> Result<PathBuf, ArchiveError> {
    fs::create_dir_all(destination)?;
    let archive_file = File::open(archive_path)?;
    let mut archive = Archive::new(GzDecoder::new(archive_file));
    let mut found_root = false;
    for entry_result in archive.entries()? {
        let mut entry = entry_result?;
        let path = entry.path()?.into_owned();
        validate_archive_path(&path)?;
        if path
            .components()
            .next()
            .is_some_and(|component| component.as_os_str() == root_name)
        {
            found_root = true;
        }
        if entry.header().entry_type().is_dir() {
            let output = destination.join(path);
            fs::create_dir_all(&output)?;
            restore_mtime(&output, entry.header().mtime()?)?;
        } else if entry.header().entry_type().is_file() {
            let output = destination.join(path);
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut file = File::create(&output)?;
            io::copy(&mut entry, &mut file)?;
            restore_mtime(&output, entry.header().mtime()?)?;
        } else {
            return Err(ArchiveError::UnsupportedEntry(path));
        }
    }
    let source_root = destination.join(root_name);
    if found_root && source_root.is_dir() {
        Ok(source_root)
    } else {
        Err(ArchiveError::MissingSourceRoot(root_name.to_owned()))
    }
}

fn restore_mtime(path: &Path, seconds: u64) -> Result<(), io::Error> {
    let modified = std::time::UNIX_EPOCH + Duration::from_secs(seconds);
    File::open(path)?.set_times(FileTimes::new().set_modified(modified))
}

fn download_verified(request: &ArchiveRequest) -> Result<PathBuf, ArchiveError> {
    let parent = request
        .cache_path
        .parent()
        .ok_or_else(|| ArchiveError::OfflineCacheMiss(request.cache_path.display().to_string()))?;
    fs::create_dir_all(parent)?;
    let partial_path = request.cache_path.with_extension("partial");
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(30))
        .timeout_read(Duration::from_secs(120))
        .build();
    let response = agent
        .get(&request.url)
        .set("User-Agent", "holy-cluster-hamlib-src/4.7.2")
        .call()
        .map_err(|error| ArchiveError::Download {
            url: request.url.clone(),
            message: error.to_string(),
        })?;
    let mut reader = response.into_reader();
    let mut output = File::create(&partial_path)?;
    io::copy(&mut reader, &mut output)?;
    verify_sha256(&partial_path, &request.expected_sha256)?;
    fs::rename(partial_path, &request.cache_path)?;
    Ok(request.cache_path.clone())
}

fn verify_sha256(path: &Path, expected: &str) -> Result<(), ArchiveError> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 32_768];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    let actual = format!("{:x}", digest.finalize());
    if actual == expected {
        Ok(())
    } else {
        Err(ArchiveError::HashMismatch {
            path: path.to_path_buf(),
            actual,
            expected: expected.to_owned(),
        })
    }
}

fn validate_archive_path(path: &Path) -> Result<(), ArchiveError> {
    if path
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
    {
        Ok(())
    } else {
        Err(ArchiveError::Traversal(path.to_path_buf()))
    }
}

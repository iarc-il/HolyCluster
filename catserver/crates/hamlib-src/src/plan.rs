use std::path::{Path, PathBuf};

use thiserror::Error;

use crate::package::HAMLIB;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkMode {
    Static,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuildPlan {
    link_mode: LinkMode,
    windows_target: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuildMetadata {
    pub version: &'static str,
    pub include_dir: PathBuf,
    pub lib_dir: PathBuf,
    pub library_file: String,
    pub link_mode: LinkMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LibusbMetadata {
    pub include_dir: PathBuf,
    pub lib_dir: PathBuf,
    pub artifact: PathBuf,
}

#[derive(Debug, Error)]
pub enum BuildPlanError {
    #[error("Hamlib only supports the x86_64-pc-windows-gnu Windows target, not {0}")]
    UnsupportedWindowsTarget(String),
}

impl BuildPlan {
    pub fn for_target(target: &str) -> Result<Self, BuildPlanError> {
        if target.contains("windows") && target != "x86_64-pc-windows-gnu" {
            return Err(BuildPlanError::UnsupportedWindowsTarget(target.to_owned()));
        }
        Ok(Self {
            link_mode: LinkMode::Static,
            windows_target: target == "x86_64-pc-windows-gnu",
        })
    }

    pub fn configure_args(&self, prefix: &Path) -> Vec<String> {
        let mut args = vec![
            format!("--prefix={}", prefix.display()),
            "--disable-dependency-tracking".to_owned(),
        ];
        args.extend(["--disable-shared".to_owned(), "--enable-static".to_owned()]);
        if self.windows_target {
            args.extend([
                "--without-cxx-binding".to_owned(),
                "--host=x86_64-w64-mingw32".to_owned(),
            ]);
        }
        args
    }

    pub fn metadata(&self, prefix: &Path) -> BuildMetadata {
        BuildMetadata {
            version: HAMLIB.version,
            include_dir: prefix.join("include"),
            lib_dir: prefix.join("lib"),
            library_file: "libhamlib.a".to_owned(),
            link_mode: self.link_mode,
        }
    }

    pub const fn is_windows(&self) -> bool {
        self.windows_target
    }
}

pub fn libusb_metadata(prefix: &Path) -> LibusbMetadata {
    let lib_dir = prefix.join("lib");
    LibusbMetadata {
        include_dir: prefix.join("include"),
        artifact: lib_dir.join("libusb-1.0.a"),
        lib_dir,
    }
}

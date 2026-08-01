use std::path::{Path, PathBuf};

use thiserror::Error;

pub const HAMLIB_VERSION: &str = "4.7.2";
pub const HAMLIB_SHA256: &str = "ae1fcf2dbc80ea0786ea8f047b09399c3f7737d1930442f61a031708ed33e88f";
pub const HAMLIB_ARCHIVE_URL: &str =
    "https://github.com/Hamlib/Hamlib/releases/download/4.7.2/hamlib-4.7.2.tar.gz";

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
            version: HAMLIB_VERSION,
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

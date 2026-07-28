use std::path::{Path, PathBuf};

use thiserror::Error;

pub const HAMLIB_VERSION: &str = "4.7.2";
pub const HAMLIB_SHA256: &str = "ae1fcf2dbc80ea0786ea8f047b09399c3f7737d1930442f61a031708ed33e88f";
pub const HAMLIB_ARCHIVE_URL: &str =
    "https://github.com/Hamlib/Hamlib/releases/download/4.7.2/hamlib-4.7.2.tar.gz";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkMode {
    Static,
    Shared,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuildPlan {
    link_mode: LinkMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuildMetadata {
    pub version: &'static str,
    pub include_dir: PathBuf,
    pub lib_dir: PathBuf,
    pub runtime_dir: PathBuf,
    pub library_file: String,
    pub runtime_library: Option<PathBuf>,
    pub import_library: Option<PathBuf>,
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
        let link_mode = if target == "x86_64-pc-windows-gnu" {
            LinkMode::Shared
        } else {
            LinkMode::Static
        };
        Ok(Self { link_mode })
    }

    pub fn configure_args(&self, prefix: &Path) -> Vec<String> {
        let mut args = vec![
            format!("--prefix={}", prefix.display()),
            "--disable-dependency-tracking".to_owned(),
        ];
        match self.link_mode {
            LinkMode::Static => {
                args.extend(["--disable-shared".to_owned(), "--enable-static".to_owned()])
            }
            LinkMode::Shared => {
                args.extend([
                    "--disable-static".to_owned(),
                    "--enable-shared".to_owned(),
                    "--without-cxx-binding".to_owned(),
                    "--host=x86_64-w64-mingw32".to_owned(),
                ]);
            }
        }
        args
    }

    pub fn metadata(&self, prefix: &Path) -> BuildMetadata {
        let library_file = match self.link_mode {
            LinkMode::Static => "libhamlib.a",
            LinkMode::Shared => "libhamlib-4.dll",
        };
        BuildMetadata {
            version: HAMLIB_VERSION,
            include_dir: prefix.join("include"),
            lib_dir: prefix.join("lib"),
            runtime_dir: match self.link_mode {
                LinkMode::Static => prefix.join("lib"),
                LinkMode::Shared => prefix.join("bin"),
            },
            library_file: library_file.to_owned(),
            runtime_library: None,
            import_library: None,
            link_mode: self.link_mode,
        }
    }

    pub const fn is_windows(&self) -> bool {
        matches!(self.link_mode, LinkMode::Shared)
    }
}

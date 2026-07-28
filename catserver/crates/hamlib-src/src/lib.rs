#![forbid(unsafe_code)]

mod archive;
mod artifact;
mod libtool;
mod plan;
#[cfg(test)]
mod target_dir;
mod toolchain;

pub use archive::{ArchiveError, ArchiveRequest, NetworkAccess, acquire_archive, extract_archive};
pub use artifact::{ArtifactError, is_ar_archive, is_pe32_plus, stage_windows_artifacts};
pub use libtool::{
    LibtoolError, LibtoolMetadata, normalize_libusb_dependency_paths, parse_libtool_metadata,
    sanitize_installed_metadata_paths, validate_windows_naming,
};
pub use plan::{
    BuildMetadata, BuildPlan, BuildPlanError, HAMLIB_ARCHIVE_URL, HAMLIB_SHA256, HAMLIB_VERSION,
    LinkMode,
};
pub use toolchain::{MINGW_TOOLCHAIN, ToolchainError, validate_mingw_toolchain};

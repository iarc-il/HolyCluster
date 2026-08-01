#![forbid(unsafe_code)]

mod archive;
mod plan;
mod source;
#[cfg(test)]
mod target_dir;
mod toolchain;

pub use archive::{ArchiveError, ArchiveRequest, NetworkAccess, acquire_archive, extract_archive};
pub use plan::{
    BuildMetadata, BuildPlan, BuildPlanError, HAMLIB_ARCHIVE_URL, HAMLIB_SHA256, HAMLIB_VERSION,
    LinkMode,
};
pub use source::{SourceOverrideError, local_source};
pub use toolchain::{MINGW_TOOLCHAIN, ToolchainError, validate_mingw_toolchain};

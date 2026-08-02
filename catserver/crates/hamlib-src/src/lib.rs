#![forbid(unsafe_code)]

mod archive;
mod package;
mod plan;
mod source;
#[cfg(test)]
mod target_dir;
mod toolchain;

pub use archive::{ArchiveError, ArchiveRequest, NetworkAccess, acquire_archive, extract_archive};
pub use package::{HAMLIB, LIBUSB, SourcePackage};
pub use plan::{
    BuildMetadata, BuildPlan, BuildPlanError, LibusbMetadata, LinkMode, libusb_metadata,
};
pub use source::{SourceOverrideError, local_source};
pub use toolchain::{MINGW_TOOLCHAIN, ToolchainError, validate_mingw_toolchain};

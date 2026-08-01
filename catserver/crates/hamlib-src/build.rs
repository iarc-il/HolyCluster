#[path = "src/archive.rs"]
mod archive;
#[path = "src/plan.rs"]
mod plan;
#[path = "src/source.rs"]
mod source;
#[path = "src/support.rs"]
mod support;
#[path = "src/target_dir.rs"]
mod target_dir;
#[path = "src/toolchain.rs"]
mod toolchain;

fn main() {
    if let Err(error) = support::build_from_environment() {
        panic!("failed to build pinned Hamlib source: {error}");
    }
}

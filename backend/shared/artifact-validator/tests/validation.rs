use holy_artifact_validator::validate_package;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

fn fixture(platform: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join(if platform == "windows" {
            "valid-windows.msi"
        } else {
            "valid-linux.AppImage"
        })
}
struct Temporary(PathBuf);
impl Temporary {
    fn copy(path: &Path) -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let copy = std::env::temp_dir().join(format!(
            "holy-package-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::copy(path, &copy).unwrap();
        Self(copy)
    }
}
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[test]
fn accepts_structural_packages_for_the_expected_release() {
    for platform in ["windows", "linux"] {
        validate_package(&fixture(platform), platform, "catserver-v1.2.3").unwrap();
    }
}

#[test]
fn rejects_swapped_platforms_even_when_the_file_is_renamed() {
    for (actual, declared) in [("windows", "linux"), ("linux", "windows")] {
        let package = Temporary::copy(&fixture(actual));
        assert!(validate_package(&package.0, declared, "catserver-v1.2.3").is_err());
    }
}

#[test]
fn rejects_other_releases_and_malformed_versions() {
    for platform in ["windows", "linux"] {
        for version in [
            "catserver-v1.2.4",
            "catserver-v1.2.3-1-gabcd",
            "invalid",
            "1.2.3-7",
            "1.2.3-0-gnothash",
        ] {
            assert!(
                validate_package(&fixture(platform), platform, version).is_err(),
                "{platform}: {version}"
            );
        }
    }
}

#[test]
fn rejects_wrong_architecture_and_missing_filesystems() {
    let package = Temporary::copy(&fixture("linux"));
    let mut bytes = fs::read(&package.0).unwrap();
    bytes[18..20].copy_from_slice(&183u16.to_le_bytes());
    fs::write(&package.0, &bytes).unwrap();
    assert!(validate_package(&package.0, "linux", "1.2.3").is_err());
    bytes[18..20].copy_from_slice(&62u16.to_le_bytes());
    fs::write(&package.0, &bytes[..64]).unwrap();
    assert!(validate_package(&package.0, "linux", "1.2.3").is_err());
}

#[test]
fn rejects_non_appimage_elf_and_truncated_msi() {
    let linux = Temporary::copy(&fixture("linux"));
    let mut bytes = fs::read(&linux.0).unwrap();
    bytes[8..11].fill(0);
    fs::write(&linux.0, bytes).unwrap();
    assert!(validate_package(&linux.0, "linux", "1.2.3").is_err());
    let windows = Temporary::copy(&fixture("windows"));
    fs::write(&windows.0, &fs::read(&windows.0).unwrap()[..512]).unwrap();
    assert!(validate_package(&windows.0, "windows", "1.2.3").is_err());
}

#[test]
fn rejects_another_product_even_with_a_valid_msi_database() {
    let package = Temporary::copy(&fixture("windows"));
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&package.0)
        .unwrap();
    let mut msi = msi::Package::open(file).unwrap();
    msi.update_rows(
        msi::Update::table("Property")
            .set("Value", msi::Value::from("Another product"))
            .with(msi::Expr::col("Property").eq(msi::Expr::string("ProductName"))),
    )
    .unwrap();
    msi.flush().unwrap();
    drop(msi);
    assert!(validate_package(&package.0, "windows", "1.2.3").is_err());
}

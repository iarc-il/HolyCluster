use {
    flate2::{Compression, write::GzEncoder},
    hamlib_src::{
        ArchiveError, ArchiveRequest, BuildPlan, LinkMode, NetworkAccess, acquire_archive,
        extract_archive, is_ar_archive, is_pe32_plus, stage_windows_artifacts,
    },
    sha2::{Digest, Sha256},
    std::{fs, io::Write, path::Path},
    tar::{Builder, Header},
    tempfile::TempDir,
};

#[test]
fn rejects_wrong_sha_before_extraction() {
    let temp = TempDir::new().unwrap();
    let archive = write_archive(temp.path(), "hamlib-4.7.2/configure", b"configure");
    let request = request(
        temp.path(),
        Some(archive),
        &"0".repeat(64),
        NetworkAccess::Disabled,
    );
    assert!(matches!(
        acquire_archive(&request),
        Err(ArchiveError::HashMismatch { .. })
    ));
}

#[test]
fn rejects_truncated_archive() {
    let temp = TempDir::new().unwrap();
    let archive = temp.path().join("truncated.tar.gz");
    fs::write(&archive, b"not a gzip archive").unwrap();
    assert!(extract_archive(&archive, &temp.path().join("output"), "hamlib-4.7.2").is_err());
}

#[test]
fn rejects_traversal_entry() {
    let temp = TempDir::new().unwrap();
    let archive = write_traversal_archive(temp.path());
    assert!(matches!(
        extract_archive(&archive, &temp.path().join("output"), "hamlib-4.7.2"),
        Err(ArchiveError::Traversal(_))
    ));
}

#[test]
fn rejects_network_disabled_cache_miss() {
    let temp = TempDir::new().unwrap();
    let request = request(temp.path(), None, &"0".repeat(64), NetworkAccess::Disabled);
    assert!(matches!(
        acquire_archive(&request),
        Err(ArchiveError::OfflineCacheMiss(_))
    ));
}

#[test]
fn removes_poisoned_cache_before_offline_failure() {
    let temp = TempDir::new().unwrap();
    let cache = temp.path().join("archive.tar.gz");
    fs::write(&cache, b"stale bytes").unwrap();
    let request = request(temp.path(), None, &"0".repeat(64), NetworkAccess::Disabled);
    assert!(matches!(
        acquire_archive(&request),
        Err(ArchiveError::OfflineCacheMiss(_))
    ));
    assert!(!cache.exists());
}

#[test]
fn removes_interrupted_download_before_offline_failure() {
    let temp = TempDir::new().unwrap();
    let partial = temp.path().join("archive.tar.gz").with_extension("partial");
    fs::write(&partial, b"interrupted bytes").unwrap();
    let request = request(temp.path(), None, &"0".repeat(64), NetworkAccess::Disabled);
    assert!(matches!(
        acquire_archive(&request),
        Err(ArchiveError::OfflineCacheMiss(_))
    ));
    assert!(!partial.exists());
}

#[test]
fn rejects_unsupported_archive_entry() {
    let temp = TempDir::new().unwrap();
    let archive = write_symlink_archive(temp.path());
    assert!(matches!(
        extract_archive(&archive, &temp.path().join("output"), "hamlib-4.7.2"),
        Err(ArchiveError::UnsupportedEntry(_))
    ));
}

#[test]
fn rejects_archive_without_expected_root() {
    let temp = TempDir::new().unwrap();
    let archive = write_archive(temp.path(), "other/configure", b"configure");
    assert!(matches!(
        extract_archive(&archive, &temp.path().join("output"), "hamlib-4.7.2"),
        Err(ArchiveError::MissingSourceRoot(_))
    ));
}

#[test]
fn distinguishes_windows_runtime_dll_from_import_archive() {
    assert!(is_ar_archive(b"!<arch>\nmember"));
    assert!(!is_pe32_plus(b"!<arch>\nmember"));
    assert!(is_pe32_plus(&pe32_plus_fixture()));
}

#[test]
fn stages_runtime_from_libtool_layout_and_keeps_import_archive() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source");
    let prefix = temp.path().join("prefix");
    fs::create_dir_all(source.join("src/.libs")).unwrap();
    fs::create_dir_all(prefix.join("lib")).unwrap();
    fs::write(
        source.join("src/.libs/libhamlib-4.dll"),
        pe32_plus_fixture(),
    )
    .unwrap();
    fs::write(prefix.join("lib/libhamlib.dll.a"), b"!<arch>\nimport").unwrap();
    fs::write(
        prefix.join("lib/libhamlib.la"),
        "dlname='libhamlib-4.dll'\nlibrary_names='libhamlib-4.dll libhamlib.dll.a'\nold_library=''\n",
    )
    .unwrap();
    let (runtime, import_library) = stage_windows_artifacts(&source, &prefix).unwrap();
    assert!(is_pe32_plus(&fs::read(runtime).unwrap()));
    assert!(is_ar_archive(&fs::read(import_library).unwrap()));
}

#[test]
fn reuses_a_valid_cache_entry() {
    let temp = TempDir::new().unwrap();
    let archive = write_archive(temp.path(), "hamlib-4.7.2/configure", b"configure");
    let request = request(
        temp.path(),
        None,
        &sha256(&archive),
        NetworkAccess::Disabled,
    );
    assert_eq!(acquire_archive(&request).unwrap(), archive);
}

#[test]
fn selects_expected_target_build_plan() {
    assert_eq!(
        BuildPlan::for_target("x86_64-pc-windows-gnu")
            .unwrap()
            .metadata(Path::new("prefix"))
            .link_mode,
        LinkMode::Shared
    );
    assert_eq!(
        BuildPlan::for_target("x86_64-unknown-linux-gnu")
            .unwrap()
            .metadata(Path::new("prefix"))
            .link_mode,
        LinkMode::Static
    );
}

#[test]
fn emits_expected_metadata() {
    let metadata = BuildPlan::for_target("x86_64-pc-windows-gnu")
        .unwrap()
        .metadata(Path::new("prefix"));
    assert_eq!(metadata.version, "4.7.2");
    assert_eq!(metadata.library_file, "libhamlib-4.dll");
    assert_eq!(metadata.runtime_dir, Path::new("prefix/bin"));
}

fn request(
    root: &Path,
    override_archive: Option<std::path::PathBuf>,
    expected_sha256: &str,
    network: NetworkAccess,
) -> ArchiveRequest {
    ArchiveRequest {
        cache_path: root.join("archive.tar.gz"),
        override_archive,
        expected_sha256: expected_sha256.to_owned(),
        network,
        url: "https://invalid.example/hamlib.tar.gz".to_owned(),
    }
}

fn write_archive(root: &Path, entry_path: &str, contents: &[u8]) -> std::path::PathBuf {
    let archive_path = root.join("archive.tar.gz");
    let file = fs::File::create(&archive_path).unwrap();
    let encoder = GzEncoder::new(file, Compression::default());
    let mut archive = Builder::new(encoder);
    let mut header = Header::new_gnu();
    header.set_size(contents.len().try_into().unwrap());
    header.set_mode(0o644);
    header.set_cksum();
    archive
        .append_data(&mut header, entry_path, contents)
        .unwrap();
    let mut encoder = archive.into_inner().unwrap();
    encoder.flush().unwrap();
    encoder.finish().unwrap();
    archive_path
}

fn sha256(path: &Path) -> String {
    let bytes = fs::read(path).unwrap();
    format!("{:x}", Sha256::digest(bytes))
}

fn write_traversal_archive(root: &Path) -> std::path::PathBuf {
    let archive_path = root.join("traversal.tar.gz");
    let file = fs::File::create(&archive_path).unwrap();
    let encoder = GzEncoder::new(file, Compression::default());
    let mut archive = Builder::new(encoder);
    let mut header = Header::new_gnu();
    header.set_size(0);
    header.as_mut_bytes()[..10].copy_from_slice(b"../escape\0");
    header.set_cksum();
    archive.append(&header, std::io::empty()).unwrap();
    let encoder = archive.into_inner().unwrap();
    encoder.finish().unwrap();
    archive_path
}

fn write_symlink_archive(root: &Path) -> std::path::PathBuf {
    let archive_path = root.join("symlink.tar.gz");
    let file = fs::File::create(&archive_path).unwrap();
    let encoder = GzEncoder::new(file, Compression::default());
    let mut archive = Builder::new(encoder);
    let mut header = Header::new_gnu();
    header.set_path("hamlib-4.7.2/link").unwrap();
    header.set_entry_type(tar::EntryType::symlink());
    header.set_link_name("target").unwrap();
    header.set_size(0);
    header.set_cksum();
    archive.append(&header, std::io::empty()).unwrap();
    let encoder = archive.into_inner().unwrap();
    encoder.finish().unwrap();
    archive_path
}

fn pe32_plus_fixture() -> Vec<u8> {
    let mut bytes = vec![0_u8; 0x100];
    bytes[..2].copy_from_slice(b"MZ");
    bytes[0x3c..0x40].copy_from_slice(&0x80_u32.to_le_bytes());
    bytes[0x80..0x84].copy_from_slice(b"PE\0\0");
    bytes[0x98..0x9a].copy_from_slice(&0x20b_u16.to_le_bytes());
    bytes
}

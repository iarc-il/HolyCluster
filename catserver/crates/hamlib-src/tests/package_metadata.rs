use {
    bzip2::{Compression, write::BzEncoder},
    hamlib_src::{HAMLIB, LIBUSB, extract_archive, libusb_metadata},
    std::{fs, path::Path},
    tar::{Builder, Header},
    tempfile::TempDir,
};

#[test]
fn pins_both_source_packages() {
    for package in [HAMLIB, LIBUSB] {
        assert!(!package.name.is_empty());
        assert!(!package.version.is_empty());
        assert!(package.url.starts_with("https://"));
        assert_eq!(package.sha256.len(), 64);
        assert!(!package.archive_root.is_empty());
        assert_eq!(package.license, "LGPL-2.1-or-later");
    }
}

#[test]
fn safely_extracts_bzip2_archives() {
    let temp = TempDir::new().unwrap();
    let archive = write_bzip2_archive(temp.path(), "libusb-1.0.30/configure", b"configure");
    let source =
        extract_archive(&archive, &temp.path().join("output"), LIBUSB.archive_root).unwrap();
    assert_eq!(fs::read(source.join("configure")).unwrap(), b"configure");
}

#[test]
fn provides_libusb_paths_under_its_private_prefix() {
    let metadata = libusb_metadata(Path::new("out/libusb"));
    assert_eq!(metadata.include_dir, Path::new("out/libusb/include"));
    assert_eq!(metadata.lib_dir, Path::new("out/libusb/lib"));
    assert_eq!(metadata.artifact, Path::new("out/libusb/lib/libusb-1.0.a"));
}

fn write_bzip2_archive(root: &Path, entry_path: &str, contents: &[u8]) -> std::path::PathBuf {
    let archive_path = root.join("archive.tar.bz2");
    let encoder = BzEncoder::new(
        fs::File::create(&archive_path).unwrap(),
        Compression::default(),
    );
    let mut archive = Builder::new(encoder);
    let mut header = Header::new_gnu();
    header.set_size(contents.len().try_into().unwrap());
    header.set_mode(0o644);
    header.set_cksum();
    archive
        .append_data(&mut header, entry_path, contents)
        .unwrap();
    archive.into_inner().unwrap().finish().unwrap();
    archive_path
}

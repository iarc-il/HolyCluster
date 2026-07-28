use {
    hamlib_src::{ArtifactError, is_ar_archive, is_pe32_plus, stage_windows_artifacts},
    std::{fs, path::Path},
    tempfile::TempDir,
};

#[test]
fn stages_lib_import_role_when_metadata_and_magic_agree() {
    let temp = TempDir::new().unwrap();
    let (source, prefix) = fixture_roots(temp.path());
    fs::write(
        source.join("src/.libs/libhamlib-4.dll"),
        pe32_plus_fixture(),
    )
    .unwrap();
    fs::write(prefix.join("lib/libhamlib.lib"), b"!<arch>\nimport").unwrap();
    fs::write(
        prefix.join("lib/libhamlib.la"),
        "dlname='../bin/libhamlib-4.dll'\nlibrary_names='libhamlib.lib'\n",
    )
    .unwrap();

    let (runtime, import_library) = stage_windows_artifacts(&source, &prefix).unwrap();

    assert!(is_pe32_plus(&fs::read(runtime).unwrap()));
    assert!(is_ar_archive(&fs::read(import_library).unwrap()));
}

#[test]
fn rejects_pe_runtime_with_ar_collision() {
    let temp = TempDir::new().unwrap();
    let (source, prefix) = fixture_roots(temp.path());
    fs::write(source.join("src/.libs/libhamlib-4.dll"), b"!<arch>\nwrong").unwrap();
    fs::write(prefix.join("lib/libhamlib.lib"), b"!<arch>\nimport").unwrap();
    fs::write(
        prefix.join("lib/libhamlib.la"),
        "dlname='libhamlib-4.dll'\nlibrary_names='libhamlib-4.dll libhamlib.lib'\n",
    )
    .unwrap();

    assert!(matches!(
        stage_windows_artifacts(&source, &prefix),
        Err(ArtifactError::InvalidRuntime(_))
    ));
}

#[test]
fn rejects_import_archive_with_misleading_lib_suffix() {
    let temp = TempDir::new().unwrap();
    let (source, prefix) = fixture_roots(temp.path());
    fs::write(
        source.join("src/.libs/libhamlib-4.dll"),
        pe32_plus_fixture(),
    )
    .unwrap();
    fs::write(prefix.join("lib/libhamlib.lib"), pe32_plus_fixture()).unwrap();
    fs::write(
        prefix.join("lib/libhamlib.la"),
        "dlname='libhamlib-4.dll'\nlibrary_names='libhamlib-4.dll libhamlib.lib'\n",
    )
    .unwrap();

    assert!(matches!(
        stage_windows_artifacts(&source, &prefix),
        Err(ArtifactError::InvalidImportLibrary(_))
    ));
}

fn fixture_roots(root: &Path) -> (std::path::PathBuf, std::path::PathBuf) {
    let source = root.join("source");
    let prefix = root.join("prefix");
    fs::create_dir_all(source.join("src/.libs")).unwrap();
    fs::create_dir_all(prefix.join("lib")).unwrap();
    (source, prefix)
}

fn pe32_plus_fixture() -> Vec<u8> {
    let mut bytes = vec![0_u8; 0x100];
    bytes[..2].copy_from_slice(b"MZ");
    bytes[0x3c..0x40].copy_from_slice(&0x80_u32.to_le_bytes());
    bytes[0x80..0x84].copy_from_slice(b"PE\0\0");
    bytes[0x98..0x9a].copy_from_slice(&0x20b_u16.to_le_bytes());
    bytes
}

use std::{fs, io, io::Cursor, path::Path};

use reqwest::Url;
use semver::Version;

use crate::updater::{
    Artifact, PLATFORM_LINUX, ReleaseManifest, UpdateService, UpdateState, copy_verified,
    parse_running_version, validate_artifact, windows_installer_command,
};

fn artifact() -> Artifact {
    Artifact {
        url: "https://releases.example/HolyCluster.AppImage".into(),
        name: "HolyCluster.AppImage".into(),
        sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".into(),
        size: 3,
    }
}

#[test]
fn rejects_unsafe_artifacts() {
    let mut value = artifact();
    value.url = "http://releases.example/update".into();
    assert!(validate_artifact(&value, PLATFORM_LINUX).is_err());
    let mut value = artifact();
    value.name = "HolyCluster.msi".into();
    assert!(validate_artifact(&value, PLATFORM_LINUX).is_err());
    let mut value = artifact();
    value.name = "../update.AppImage".into();
    assert!(validate_artifact(&value, PLATFORM_LINUX).is_err());
}

#[test]
fn verifies_bounded_downloads() {
    copy_verified(&mut Cursor::new(b"abc"), io::sink(), &artifact()).unwrap();
}

#[test]
fn rejects_equal_and_downgrade_versions() {
    let service = UpdateService::with_data_dir(
        Url::parse("https://releases.example/manifest.json").unwrap(),
        "1.2.0",
        std::env::temp_dir(),
    )
    .unwrap();
    let manifest = ReleaseManifest {
        version: "1.2.0".into(),
        artifacts: [(PLATFORM_LINUX.into(), artifact())].into(),
    };
    assert!(service.accept_manifest(manifest).is_err());
}

#[test]
fn compares_against_the_release_tag_not_git_describe_suffix() {
    assert_eq!(
        parse_running_version("catserver-v1.2.0-1340-g4a8f4fdf").unwrap(),
        Version::parse("1.2.0").unwrap()
    );
}

#[test]
fn persists_deferred_status() {
    let data_dir = std::env::temp_dir().join(format!(
        "catserver-update-state-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let service = UpdateService::with_data_dir(
        Url::parse("https://releases.example/manifest.json").unwrap(),
        "1.2.0",
        data_dir.clone(),
    )
    .unwrap();
    assert_eq!(service.defer().unwrap().state, UpdateState::Deferred);
    assert_eq!(service.status().state, UpdateState::Deferred);
    fs::remove_dir_all(data_dir).unwrap();
}

#[test]
fn builds_silent_msi_command_without_shell() {
    let command = windows_installer_command(Path::new("C:/safe/update.msi"));
    assert_eq!(command.get_program(), "msiexec.exe");
    assert_eq!(
        command.get_args().collect::<Vec<_>>(),
        ["/i", "C:/safe/update.msi", "/qn", "/norestart"]
    );
}

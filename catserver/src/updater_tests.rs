#[cfg(target_os = "linux")]
use std::os::fd::AsRawFd;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{fs, io, io::Cursor, path::Path};

use reqwest::Url;

#[cfg(not(windows))]
use crate::updater::close_inherited_descriptors_on_exec;
use crate::updater::{
    AppRelease, Artifact, PLATFORM_LINUX, ReleaseManifest, UpdateService, UpdateState,
    copy_verified, make_executable, validate_artifact, windows_installer_command,
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
        schema_version: 1,
        releases: vec![AppRelease {
            version: "1.2.0".into(),
            platform: "linux".into(),
            architecture: "x86_64".into(),
            artifact: artifact(),
        }],
    };
    assert!(service.accept_manifest(manifest).unwrap().is_none());
}

#[test]
fn reports_equal_release_as_current() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let body = serde_json::json!({
        "schema_version": 1,
        "releases": [{
            "version": "1.2.0",
            "platform": "linux",
            "architecture": "x86_64",
            "artifact": artifact()
        }]
    })
    .to_string();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0; 1024];
        std::io::Read::read(&mut stream, &mut request).unwrap();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        std::io::Write::write_all(&mut stream, response.as_bytes()).unwrap();
    });
    let data_dir =
        std::env::temp_dir().join(format!("catserver-update-current-{}", std::process::id()));
    let service = UpdateService::with_data_dir(
        Url::parse(&format!("http://{address}/manifest.json")).unwrap(),
        "1.2.0",
        data_dir.clone(),
    )
    .unwrap();

    let status = service.check().unwrap();

    assert_eq!(status.state, UpdateState::Idle);
    let persisted = service.status();
    assert_eq!(persisted.state, UpdateState::Idle);
    assert!(persisted.available_version.is_none());
    assert!(persisted.diagnostic.is_none());
    server.join().unwrap();
    fs::remove_dir_all(data_dir).unwrap();
}

#[test]
fn compares_development_commit_numbers() {
    let service = UpdateService::with_data_dir(
        Url::parse("https://releases.example/manifest.json").unwrap(),
        "catserver-v1.2.0-1340-g4a8f4fdf",
        std::env::temp_dir(),
    )
    .unwrap();
    let manifest = |version: &str| ReleaseManifest {
        schema_version: 1,
        releases: vec![AppRelease {
            version: version.into(),
            platform: "linux".into(),
            architecture: "x86_64".into(),
            artifact: artifact(),
        }],
    };

    assert!(
        service
            .accept_manifest(manifest("catserver-v1.2.0-1341-gnewer"))
            .unwrap()
            .is_some()
    );
    assert!(
        service
            .accept_manifest(manifest("catserver-v1.2.0-1340-gsame"))
            .unwrap()
            .is_none()
    );
    assert!(
        service
            .accept_manifest(manifest("catserver-v1.2.0-1339-golder"))
            .unwrap()
            .is_none()
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

#[cfg(unix)]
#[test]
fn makes_staged_appimage_executable() {
    let path = std::env::temp_dir().join(format!(
        "catserver-update-permissions-{}",
        std::process::id()
    ));
    fs::write(&path, b"appimage").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o664)).unwrap();

    make_executable(&path).unwrap();

    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o755
    );
    fs::remove_file(path).unwrap();
}

#[cfg(target_os = "linux")]
#[test]
fn closes_inherited_descriptors_on_exec() {
    let file = fs::File::open("/dev/null").unwrap();
    let standard_flags = (0..=libc::STDERR_FILENO)
        .map(|fd| unsafe { libc::fcntl(fd, libc::F_GETFD) })
        .collect::<Vec<_>>();

    close_inherited_descriptors_on_exec().unwrap();

    let flags = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETFD) };
    assert_ne!(flags & libc::FD_CLOEXEC, 0);
    for (fd, flags) in (0..=libc::STDERR_FILENO).zip(standard_flags) {
        assert_eq!(
            unsafe { libc::fcntl(fd, libc::F_GETFD) },
            flags & !libc::FD_CLOEXEC
        );
    }
}

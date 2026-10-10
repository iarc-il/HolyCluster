use super::*;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("update-interruption-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn service(&self) -> UpdateService {
        UpdateService::with_data_dir(
            Url::parse("https://releases.example/manifest.json").unwrap(),
            "1.2.0",
            self.0.clone(),
        )
        .unwrap()
    }
    fn session(&self, phase: &str) -> Arc<SessionStore> {
        let store = SessionStore::create(
            self.0.join("session.json"),
            "interrupted".into(),
            41234,
            "http://127.0.0.1:41234".into(),
            "1.3.0".into(),
            3,
        )
        .unwrap();
        store.phase(phase).unwrap();
        store
    }
    #[cfg(target_os = "linux")]
    fn plan(&self) -> InstallPlan {
        let current_executable = self.0.join("HolyCluster.AppImage");
        let staged_artifact = self.0.join("download");
        fs::write(&current_executable, b"old").unwrap();
        make_executable(&current_executable).unwrap();
        fs::write(&staged_artifact, b"abc").unwrap();
        InstallPlan {
            current_executable,
            staged_artifact,
            artifact: Artifact {
                url: "https://releases.example/HolyCluster.AppImage".into(),
                name: "HolyCluster.AppImage".into(),
                sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".into(),
                size: 3,
            },
            state_path: self.0.join("state.json"),
            parent_pid: std::process::id(),
            version: Some("1.3.0".into()),
            reinstall: false,
            command_args: vec![],
            restart: None,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn abandoned_download_and_verification_allow_retry() {
    for phase in ["downloading", "verifying"] {
        for dead_helper in [false, true] {
            let fixture = Fixture::new();
            let service = fixture.service();
            fixture.session(phase);
            if dead_helper {
                write_json(
                    &service.helper_path(),
                    &UpdateHelper {
                        pid: 42,
                        started_at: 123,
                    },
                )
                .unwrap();
            }
            assert!(service.exclusive(|| Ok(())).unwrap_err().is::<UpdateBusy>());
            service
                .reconcile_installing_status_with(|_| Some(false))
                .unwrap();
            assert_eq!(service.session().unwrap().phase, "failed");
            assert_eq!(service.status().state, UpdateState::Failed);
            service.exclusive(|| service.retry()).unwrap();
            assert!(service.session().is_none());
            assert_eq!(service.status().state, UpdateState::Idle);
        }
    }
}

#[test]
fn uncertain_preinstaller_ownership_keeps_update_locked() {
    for phase in ["downloading", "verifying"] {
        for case in [
            "active",
            "unknown",
            "malformed",
            "helper_url",
            "unconfirmed",
            "installing",
        ] {
            let fixture = Fixture::new();
            let service = fixture.service();
            let store = fixture.session(phase);
            match case {
                "active" | "unknown" => {
                    write_json(
                        &service.helper_path(),
                        &UpdateHelper {
                            pid: 42,
                            started_at: 123,
                        },
                    )
                    .unwrap();
                }
                "malformed" => fs::write(service.helper_path(), b"invalid").unwrap(),
                "helper_url" => {
                    store
                        .change(|session| {
                            session.helper_url = Some("http://127.0.0.1:41235".into())
                        })
                        .unwrap();
                    write_json(
                        &service.helper_path(),
                        &UpdateHelper {
                            pid: 42,
                            started_at: 123,
                        },
                    )
                    .unwrap();
                }
                "unconfirmed" => store
                    .change(|session| session.installer_outcome = Some("unconfirmed".into()))
                    .unwrap(),
                "installing" => service
                    .write_status(&UpdateStatus {
                        state: UpdateState::Installing,
                        available_version: None,
                        diagnostic: None,
                    })
                    .unwrap(),
                _ => unreachable!(),
            }
            service
                .reconcile_installing_status_with(|_| match case {
                    "active" => Some(true),
                    "helper_url" => Some(false),
                    _ => None,
                })
                .unwrap();
            assert_eq!(service.session().unwrap().phase, phase, "{case}");
            assert!(
                service
                    .exclusive(|| service.retry())
                    .unwrap_err()
                    .is::<UpdateBusy>(),
                "{case}"
            );
        }
    }
}

// Command::exec changes process signal state even when exec fails. Keep those
// checks in filtered child processes so unrelated tests keep their signal state.
#[cfg(target_os = "linux")]
fn exec_test_in_child(test: &str) -> bool {
    if std::env::var("HOLY_UPDATE_EXEC_TEST").as_deref() == Ok(test) {
        return false;
    }
    assert!(
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", test])
            .env("HOLY_UPDATE_EXEC_TEST", test)
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap()
            .success()
    );
    true
}

#[cfg(target_os = "linux")]
#[test]
fn activation_boundaries_keep_complete_launcher_and_singleton_owner() {
    if exec_test_in_child(
        "updater::interruption_tests::activation_boundaries_keep_complete_launcher_and_singleton_owner",
    ) {
        return;
    }
    let fixture = Fixture::new();
    let plan = fixture.plan();
    let name = format!("HolyCluster-update-test-{}", uuid::Uuid::new_v4());
    let owner = single_instance::SingleInstance::new(&name).unwrap();
    assert!(owner.is_single());
    let check = |expected: &[u8]| {
        assert_eq!(fs::read(&plan.current_executable).unwrap(), expected);
        assert!(
            !single_instance::SingleInstance::new(&name)
                .unwrap()
                .is_single()
        );
        assert!(
            Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "updater::interruption_tests::second_launch_probe"
                ])
                .env("HOLY_UPDATE_TEST_SINGLETON", &name)
                .stdout(std::process::Stdio::null())
                .status()
                .unwrap()
                .success()
        );
    };
    // Each completed filesystem boundary is safe if the process stops here.
    check(b"old");
    let activation = prepare_linux_activation(&plan).unwrap();
    check(b"old");
    backup_linux(&plan).unwrap();
    check(b"old");
    assert_eq!(
        fs::read(plan.current_executable.with_extension("AppImage.previous")).unwrap(),
        b"old"
    );
    activate_linux(&activation, &plan.current_executable).unwrap();
    check(b"abc");
    // Force EACCES, rather than ENOEXEC (execvp can run a shell fallback).
    fs::set_permissions(&plan.current_executable, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(
        exec_linux(&plan)
            .unwrap_err()
            .to_string()
            .contains("previous version restored")
    );
    check(b"old");
    drop(owner);
    assert!(
        single_instance::SingleInstance::new(&name)
            .unwrap()
            .is_single()
    );
}

#[cfg(target_os = "linux")]
#[test]
fn second_launch_probe() {
    if let Ok(name) = std::env::var("HOLY_UPDATE_TEST_SINGLETON") {
        assert!(
            !single_instance::SingleInstance::new(&name)
                .unwrap()
                .is_single()
        );
    }
}

#[cfg(target_os = "linux")]
#[test]
fn failed_preparation_backup_and_activation_leave_old_launcher() {
    let fixture = Fixture::new();
    let plan = fixture.plan();
    fs::write(&plan.staged_artifact, b"bad").unwrap();
    assert!(prepare_linux_activation(&plan).is_err());
    assert_eq!(fs::read(&plan.current_executable).unwrap(), b"old");
    fs::write(&plan.staged_artifact, b"abc").unwrap();
    let activation = prepare_linux_activation(&plan).unwrap();
    let backup = plan.current_executable.with_extension("AppImage.previous");
    fs::create_dir(&backup).unwrap();
    assert!(backup_linux(&plan).is_err());
    assert_eq!(fs::read(&plan.current_executable).unwrap(), b"old");
    fs::remove_dir(&backup).unwrap();
    backup_linux(&plan).unwrap();
    fs::remove_file(&activation).unwrap();
    assert!(activate_linux(&activation, &plan.current_executable).is_err());
    assert_eq!(fs::read(&plan.current_executable).unwrap(), b"old");
}

#[cfg(target_os = "linux")]
#[test]
fn failed_rollback_does_not_unlink_updated_launcher() {
    if exec_test_in_child(
        "updater::interruption_tests::failed_rollback_does_not_unlink_updated_launcher",
    ) {
        return;
    }
    let fixture = Fixture::new();
    let plan = fixture.plan();
    let activation = prepare_linux_activation(&plan).unwrap();
    backup_linux(&plan).unwrap();
    activate_linux(&activation, &plan.current_executable).unwrap();
    fs::remove_file(plan.current_executable.with_extension("AppImage.previous")).unwrap();
    fs::set_permissions(&plan.current_executable, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(
        exec_linux(&plan)
            .unwrap_err()
            .to_string()
            .contains("cannot restore previous version")
    );
    assert_eq!(fs::read(&plan.current_executable).unwrap(), b"abc");
}

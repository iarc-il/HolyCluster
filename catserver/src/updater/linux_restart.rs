use super::*;
use std::{os::unix::fs::MetadataExt, time::SystemTime};

pub(super) fn recover(
    path: &Path,
    executable: &Path,
    version: &str,
    arguments: &[String],
    started: SystemTime,
) -> Result<RestartContext> {
    let directory = path.parent().context("update plan has no directory")?;
    let state_path = directory.join("state.json");
    let metadata = fs::symlink_metadata(directory)?;
    anyhow::ensure!(
        metadata.is_dir()
            && metadata.uid() == fs::metadata("/proc/self")?.uid()
            && metadata.mode() & 0o002 == 0,
        "update directory is not owned by this user"
    );
    owned_file(path)?;
    owned_file(&state_path)?;
    let mut plan: InstallPlan = serde_json::from_slice(&fs::read(path)?)?;
    let status = read_status(&state_path)?;
    let borrowed = arguments.iter().map(String::as_str).collect::<Vec<_>>();
    let args = <crate::args::Args as argh::FromArgs>::from_args(&["catserver"], &borrowed)
        .map_err(|_| anyhow::anyhow!("update launch arguments are invalid"))?;
    anyhow::ensure!(
        args.resume_update.as_deref() == plan.restart.as_ref().map(|_| path)
            && args.apply_update.is_none()
            && args.elevate_update.is_none()
            && !args.close,
        "explicit update restart requires its resume flag"
    );
    anyhow::ensure!(
        plan.parent_pid == std::process::id()
            && plan.state_path == state_path
            && plan.current_executable == executable
            && original_arguments(&plan.command_args) == original_arguments(arguments),
        "update handoff does not belong to this process"
    );
    anyhow::ensure!(
        status.state == UpdateState::Installed
            && status.available_version.as_deref() == plan.version.as_deref()
            && plan.version.as_deref().is_some_and(|target| {
                parse_version(target).ok() == parse_version(version).ok()
            }),
        "update handoff has no matching completed install"
    );
    let modified = fs::metadata(&state_path)?.modified()?;
    anyhow::ensure!(
        modified >= started && SystemTime::now().duration_since(modified)?.as_secs() < 120,
        "update handoff is stale"
    );
    owned_file(executable)?;
    verify_plan_file(executable, &plan, PLATFORM_LINUX)?;
    let session_path = directory.join("session.json");
    let context = if let Some(context) = &plan.restart {
        owned_file(&session_path)?;
        let session = SessionStore::load(&session_path)?.snapshot();
        anyhow::ensure!(
            !session.terminal()
                && session.owner.as_ref().is_none_or(|owner| {
                    owner.pid == std::process::id()
                        && owner.active(Path::new("/proc")).unwrap_or(false)
                })
                && session.id == context.id
                && session.port == context.port
                && session.expected_version == context.expected_version
                && context.state_path == state_path
                && plan.version.as_deref() == Some(context.expected_version.as_str()),
            "update restart session differs from its plan"
        );
        context.clone()
    } else {
        // Only 1.3.3 used an owned exec without the persisted restart protocol.
        anyhow::ensure!(
            !session_path.exists() && !directory.join("update-helper.json").exists(),
            "legacy update has foreign session state"
        );
        let backup = executable.with_extension("AppImage.previous");
        owned_file(&backup)?;
        holy_artifact_validator::validate_package(&backup, "linux", "catserver-v1.3.3")?;
        let port = crate::args::server_config(&args)?.local_port;
        let context = RestartContext {
            id: uuid::Uuid::new_v4().to_string(),
            port,
            expected_version: plan.version.clone().context("update target is missing")?,
            state_path,
        };
        SessionStore::create(
            session_path,
            context.id.clone(),
            port,
            format!("http://127.0.0.1:{port}"),
            context.expected_version.clone(),
            plan.artifact.size,
        )?
        .phase("reconnecting")?;
        plan.restart = Some(context.clone());
        write_json(path, &plan)?;
        context
    };
    anyhow::ensure!(
        !context.id.is_empty() && context.port != 0,
        "invalid update restart identity"
    );
    Ok(context)
}

fn owned_file(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    anyhow::ensure!(
        metadata.is_file()
            && metadata.uid() == fs::metadata("/proc/self")?.uid()
            && metadata.mode() & 0o002 == 0,
        "update handoff file is not privately owned: {}",
        path.display()
    );
    Ok(())
}

pub(super) fn process_started() -> Result<SystemTime> {
    let ticks =
        crate::update_progress::UpdateOwner::start_time(Path::new("/proc"), std::process::id())?
            .context("update owner process is missing")? as f64;
    let uptime: f64 = fs::read_to_string("/proc/uptime")?
        .split_whitespace()
        .next()
        .context("missing system uptime")?
        .parse()?;
    let frequency = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    anyhow::ensure!(frequency > 0, "cannot determine process clock frequency");
    // /proc uptime has only two decimal places.
    Ok(SystemTime::now()
        - Duration::from_secs_f64((uptime - ticks / frequency as f64 + 0.02).max(0.0)))
}

pub(crate) fn startup_context() -> Option<RestartContext> {
    let result = (|| {
        let dirs = ProjectDirs::from("org", "IARC", "HolyCluster")
            .context("cannot determine update data directory")?;
        recover(
            &dirs.data_local_dir().join("updates/install-plan.json"),
            &update_target()?,
            env!("VERSION"),
            &std::env::args().skip(1).collect::<Vec<_>>(),
            process_started()?,
        )
    })();
    match result {
        Ok(context) => Some(context),
        Err(error) => {
            tracing::debug!(?error, "No owned Linux update handoff");
            None
        }
    }
}

pub(crate) fn complete(context: &RestartContext) -> Result<()> {
    let store = SessionStore::load(&context.state_path.with_file_name("session.json"))?;
    anyhow::ensure!(
        store.snapshot().id == context.id,
        "update completion identity differs"
    );
    store.change(|session| {
        session.downloaded = session.total;
        session.installer_outcome = Some("installed".into());
        session.phase = "updated".into();
        session.diagnostic = None;
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CANDIDATE: &[u8] =
        include_bytes!("../../../backend/shared/artifact-validator/fixtures/valid-linux.AppImage");
    const BASELINE: &[u8] = include_bytes!("../../tests/fixtures/legacy-1.3.3.AppImage");

    struct Fixture {
        dir: tempfile::TempDir,
        executable: PathBuf,
        arguments: Vec<String>,
        started: SystemTime,
    }
    impl Fixture {
        fn new(explicit: bool) -> Self {
            let dir = tempfile::tempdir().unwrap();
            let executable = dir.path().join("CATServer.AppImage");
            fs::write(&executable, CANDIDATE).unwrap();
            fs::write(executable.with_extension("AppImage.previous"), BASELINE).unwrap();
            let state_path = dir.path().join("state.json");
            let mut arguments = vec!["--listen-port".into(), "41234".into(), "--dummy".into()];
            if explicit {
                arguments.extend([
                    "--resume-update".into(),
                    dir.path()
                        .join("install-plan.json")
                        .to_string_lossy()
                        .into_owned(),
                ]);
            }
            let restart = explicit.then(|| RestartContext {
                id: "owned-update".into(),
                port: 41234,
                expected_version: "1.2.3".into(),
                state_path: state_path.clone(),
            });
            if let Some(context) = &restart {
                SessionStore::create(
                    dir.path().join("session.json"),
                    context.id.clone(),
                    context.port,
                    "http://127.0.0.1:41234".into(),
                    context.expected_version.clone(),
                    CANDIDATE.len() as u64,
                )
                .unwrap()
                .phase("reconnecting")
                .unwrap();
            }
            write_json(
                &state_path,
                &UpdateStatus {
                    state: UpdateState::Installed,
                    available_version: Some("1.2.3".into()),
                    diagnostic: None,
                },
            )
            .unwrap();
            let plan = InstallPlan {
                current_executable: executable.clone(),
                staged_artifact: dir.path().join("staged"),
                artifact: Artifact {
                    url: "https://example.org/candidate".into(),
                    name: "candidate.AppImage".into(),
                    sha256: format!("{:x}", Sha256::digest(CANDIDATE)),
                    size: CANDIDATE.len() as u64,
                },
                state_path,
                parent_pid: std::process::id(),
                version: Some("1.2.3".into()),
                release_version: Some("catserver-v1.2.3".into()),
                force_update: true,
                command_args: original_arguments(&arguments),
                restart,
            };
            write_json(&dir.path().join("install-plan.json"), &plan).unwrap();
            for file in fs::read_dir(dir.path()).unwrap() {
                fs::set_permissions(file.unwrap().path(), fs::Permissions::from_mode(0o600))
                    .unwrap();
            }
            Self {
                dir,
                executable,
                arguments,
                started: SystemTime::now() - Duration::from_secs(10),
            }
        }
        fn recover(&self) -> Result<RestartContext> {
            recover(
                &self.dir.path().join("install-plan.json"),
                &self.executable,
                "catserver-v1.2.3",
                &self.arguments,
                self.started,
            )
        }
        fn change_plan(&self, field: &str, value: serde_json::Value) {
            let path = self.dir.path().join("install-plan.json");
            let mut plan: serde_json::Value =
                serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            plan[field] = value;
            fs::write(path, plan.to_string()).unwrap();
        }
    }

    #[test]
    fn explicit_linux_restart_keeps_identity_port_and_completes_session() {
        let fixture = Fixture::new(true);
        let context = fixture.recover().unwrap();
        assert_eq!(context.id, "owned-update");
        assert_eq!(context.port, 41234);
        complete(&context).unwrap();
        let session = SessionStore::load(&fixture.dir.path().join("session.json"))
            .unwrap()
            .snapshot();
        assert!(session.terminal());
        assert_eq!(session.phase, "updated");
        assert_eq!(session.installer_outcome.as_deref(), Some("installed"));
        let plan: InstallPlan = serde_json::from_slice(
            &fs::read(fixture.dir.path().join("install-plan.json")).unwrap(),
        )
        .unwrap();
        let command = restart_command(&plan, &fixture.dir.path().join("install-plan.json"));
        let args: Vec<_> = command.get_args().collect();
        assert!(args.iter().any(|arg| *arg == "--resume-update"));
        assert!(fixture.recover().is_err());
        let mut normal_start = Fixture::new(true);
        normal_start.arguments = original_arguments(&normal_start.arguments);
        assert!(normal_start.recover().is_err());
    }

    #[test]
    fn startup_preserves_owned_handoffs_but_rejects_an_abandoned_restart_owner() {
        for owner_state in ["live", "legacy", "dead", "reused", "rebooted"] {
            let fixture = Fixture::new(true);
            let path = fixture.dir.path().join("session.json");
            let mut session: serde_json::Value =
                serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            if owner_state == "legacy" {
                session.as_object_mut().unwrap().remove("owner");
            } else if owner_state == "reused" {
                session["owner"]["started_at"] = 0.into();
            } else if owner_state == "dead" {
                session["owner"]["pid"] = u32::MAX.into();
            } else if owner_state == "rebooted" {
                session["owner"]["boot_id"] = "previous-boot".into();
            }
            write_json(&path, &session).unwrap();
            let context = fixture.recover();
            let service = UpdateService::with_data_dir(
                Url::parse("https://releases.example/manifest.json").unwrap(),
                "catserver-v1.2.3",
                fixture.dir.path().to_owned(),
            )
            .unwrap();
            if matches!(owner_state, "dead" | "reused" | "rebooted") {
                assert!(context.is_err());
                assert!(service.session().unwrap().terminal());
                assert_eq!(service.status().state, UpdateState::Failed);
                assert!(!service.readiness().verified);
                assert!(service.exclusive(|| service.retry()).is_ok());
            } else {
                assert_eq!(service.session().unwrap().phase, "reconnecting");
                assert!(service.exclusive(|| Ok(())).is_err());
                let service = service.with_restart(Some(context.unwrap()));
                assert!(service.readiness().verified);
                assert_eq!(
                    service.readiness().update_id.as_deref(),
                    Some("owned-update")
                );
            }
        }
    }

    #[test]
    fn legacy_133_handoff_recovers_once_and_completes_the_owned_session() {
        let fixture = Fixture::new(false);
        let context = fixture.recover().unwrap();
        assert_eq!(context.port, 41234);
        assert!(!context.id.is_empty());
        let persisted: InstallPlan = serde_json::from_slice(
            &fs::read(fixture.dir.path().join("install-plan.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(persisted.restart.unwrap().id, context.id);
        complete(&context).unwrap();
        assert!(fixture.recover().is_err());
    }

    #[test]
    fn rejects_normal_stale_foreign_and_unverified_linux_handoffs() {
        for explicit in [false, true] {
            for field in [
                "parent_pid",
                "state_path",
                "current_executable",
                "version",
                "command_args",
            ] {
                let fixture = Fixture::new(explicit);
                let value = match field {
                    "parent_pid" => serde_json::json!(u32::MAX),
                    "command_args" => serde_json::json!([]),
                    _ => serde_json::json!("foreign"),
                };
                fixture.change_plan(field, value);
                assert!(fixture.recover().is_err(), "{field}, explicit={explicit}");
            }
            let mut fixture = Fixture::new(explicit);
            fixture.started = SystemTime::now() + Duration::from_secs(1);
            assert!(fixture.recover().is_err());
            let fixture = Fixture::new(explicit);
            fs::write(&fixture.executable, b"unrelated executable").unwrap();
            assert!(fixture.recover().is_err());
            let fixture = Fixture::new(explicit);
            write_json(
                &fixture.dir.path().join("state.json"),
                &UpdateStatus::default(),
            )
            .unwrap();
            assert!(fixture.recover().is_err());
        }
        let fixture = Fixture::new(false);
        fs::write(
            fixture.executable.with_extension("AppImage.previous"),
            CANDIDATE,
        )
        .unwrap();
        assert!(fixture.recover().is_err());
    }
}

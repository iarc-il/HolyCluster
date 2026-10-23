use std::{
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use serde_json::{Value, json};

static RUNTIME: OnceLock<Runtime> = OnceLock::new();

struct Runtime {
    started: Instant,
    start_time: u64,
    launch: Value,
    state: Mutex<State>,
}

struct State {
    phase: &'static str,
    owner_path: Option<PathBuf>,
    port: Option<u16>,
}

fn runtime() -> &'static Runtime {
    RUNTIME.get_or_init(|| Runtime {
        started: Instant::now(),
        start_time: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        launch: json!({}),
        state: Mutex::new(State {
            phase: "starting",
            owner_path: None,
            port: None,
        }),
    })
}

pub(crate) fn initialize(args: &crate::args::Args) {
    let mode = if args.apply_update.is_some() {
        "apply_update"
    } else if args.resume_update.is_some() {
        "resume_update"
    } else if args.elevate_update.is_some() {
        "elevate_update"
    } else if args.close {
        "close"
    } else {
        "normal"
    };
    let config = crate::args::server_config(args);
    let _ = RUNTIME.set(Runtime {
        started: Instant::now(),
        start_time: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        launch: json!({
            "launch_mode": mode, "backend": config.dns,
            "requested_local_port": args.port, "default_local_port": config.local_port,
            "dev_server": args.dev_server, "local_ui": args.local_ui,
            "dummy": args.dummy, "dummy_rotator": args.dummy_rotator,
            "no_browser": args.no_browser,
        }),
        state: Mutex::new(State {
            phase: "starting",
            owner_path: None,
            port: None,
        }),
    });
}

pub(crate) fn context() -> Value {
    let runtime = runtime();
    let mut context = runtime.launch.clone();
    let state = runtime.state.lock().unwrap_or_else(|e| e.into_inner());
    context["lifecycle_phase"] = state.phase.into();
    context["process_uptime_ms"] = (runtime.started.elapsed().as_millis() as u64).into();
    context["release"] = env!("VERSION").into();
    context["environment"] = env!("CATSERVER_SENTRY_ENVIRONMENT").into();
    context
}

pub(crate) fn phase(phase: &'static str) {
    let mut state = runtime().state.lock().unwrap_or_else(|e| e.into_inner());
    state.phase = phase;
    publish_owner(&state);
    tracing::info!(target: "catserver::diagnostic", phase, "Lifecycle transition");
}

pub(crate) fn own(port_file: &std::path::Path) {
    let mut state = runtime().state.lock().unwrap_or_else(|e| e.into_inner());
    state.owner_path = Some(port_file.with_file_name("instance-owner.json"));
    publish_owner(&state);
}

pub(crate) fn port(port: u16) {
    let mut state = runtime().state.lock().unwrap_or_else(|e| e.into_inner());
    state.port = Some(port);
    publish_owner(&state);
}

fn publish_owner(state: &State) {
    let Some(path) = &state.owner_path else {
        return;
    };
    let result = (|| -> anyhow::Result<()> {
        std::fs::create_dir_all(path.parent().unwrap())?;
        let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap())?;
        use std::io::Write;
        serde_json::to_writer(
            &mut file,
            &json!({
                "pid": std::process::id(), "release": env!("VERSION"),
                "start_time_unix": runtime().start_time, "lifecycle_phase": state.phase,
                "port": state.port,
            }),
        )?;
        file.flush()?;
        file.persist(path)?;
        Ok(())
    })();
    if let Err(error) = result {
        tracing::warn!(?error, "Cannot publish diagnostic instance owner state");
    }
}

pub(crate) fn instance_evidence(port_file: &std::path::Path) -> Value {
    let metadata = std::fs::metadata(port_file);
    let owner = std::fs::read_to_string(port_file.with_file_name("instance-owner.json"));
    json!({
        "port_file": port_file, "port_file_exists": port_file.exists(),
        "port_file_age_ms": metadata.ok().and_then(|m| m.modified().ok())
            .and_then(|time| time.elapsed().ok()).map(|d| d.as_millis() as u64),
        "owner_state": owner.as_ref().ok().map(|text| serde_json::from_str::<Value>(text).unwrap_or_else(|_| text.clone().into())),
        "owner_read_error": owner.err().map(|e| e.to_string()),
    })
}

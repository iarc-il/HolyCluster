use std::{
    sync::{Mutex, OnceLock},
    time::Instant,
};

use serde_json::{Value, json};

static RUNTIME: OnceLock<Runtime> = OnceLock::new();

struct Runtime {
    started: Instant,
    launch: Value,
    phase: Mutex<&'static str>,
}

fn runtime() -> &'static Runtime {
    RUNTIME.get_or_init(|| Runtime {
        started: Instant::now(),
        launch: json!({}),
        phase: Mutex::new("starting"),
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
        launch: json!({
            "launch_mode": mode, "backend": config.dns,
            "requested_local_port": args.port, "default_local_port": config.local_port,
            "dev_server": args.dev_server, "local_ui": args.local_ui,
            "dummy": args.dummy, "dummy_rotator": args.dummy_rotator,
            "no_browser": args.no_browser,
        }),
        phase: Mutex::new("starting"),
    });
}

pub(crate) fn context() -> Value {
    let runtime = runtime();
    let mut context = runtime.launch.clone();
    context["lifecycle_phase"] = (*runtime.phase.lock().unwrap_or_else(|e| e.into_inner())).into();
    context["process_uptime_ms"] = (runtime.started.elapsed().as_millis() as u64).into();
    context["release"] = env!("VERSION").into();
    context["environment"] = env!("CATSERVER_SENTRY_ENVIRONMENT").into();
    context
}

pub(crate) fn phase(phase: &'static str) {
    *runtime().phase.lock().unwrap_or_else(|e| e.into_inner()) = phase;
    tracing::info!(target: "catserver::diagnostic", phase, "Lifecycle transition");
}

pub(crate) fn bytes_value(bytes: &[u8]) -> Value {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.into(),
        Err(_) => json!({"bytes": bytes}),
    }
}

pub(crate) fn os_value(value: &std::ffi::OsStr) -> Value {
    if let Some(text) = value.to_str() {
        return text.into();
    }
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        json!({"unix_bytes": value.as_bytes()})
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let units = value.encode_wide().collect::<Vec<_>>();
        json!({"windows_utf16": units})
    }
}

pub(crate) fn path_value(path: &std::path::Path) -> Value {
    os_value(
        crate::diagnostic_redaction::Redactions::current()
            .path(path)
            .as_os_str(),
    )
}

pub(crate) fn payload(bytes: &[u8]) -> Value {
    bytes_value(&bytes[..bytes.len().min(16 * 1024)])
}

pub(crate) fn instance_evidence(port_file: &std::path::Path) -> Value {
    let metadata = std::fs::metadata(port_file);
    json!({
        "port_file": path_value(port_file), "port_file_exists": port_file.exists(),
        "port_file_age_ms": metadata.ok().and_then(|m| m.modified().ok())
            .and_then(|time| time.elapsed().ok()).map(|d| d.as_millis() as u64),
    })
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn os_values_preserve_unpaired_surrogates() {
        use std::os::windows::ffi::OsStringExt;
        let value = std::ffi::OsString::from_wide(&[120, 0xd800]);
        assert_eq!(
            super::os_value(&value),
            serde_json::json!({"windows_utf16": [120, 0xd800]})
        );
    }

    #[cfg(unix)]
    #[test]
    fn instance_paths_preserve_non_unicode_bytes() {
        use std::{
            ffi::OsString,
            os::unix::ffi::{OsStrExt, OsStringExt},
        };
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(OsString::from_vec(vec![b'p', 0xff]));
        let evidence = super::instance_evidence(&path);
        assert_eq!(
            evidence["port_file"],
            serde_json::json!({"unix_bytes": path.as_os_str().as_bytes()})
        );
    }
}

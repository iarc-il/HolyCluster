use std::process::{Command, Stdio};

pub(crate) fn context() -> serde_json::Value {
    [
        "DISPLAY",
        "WAYLAND_DISPLAY",
        "XDG_SESSION_TYPE",
        "DESKTOP_SESSION",
        "XDG_CURRENT_DESKTOP",
    ]
    .into_iter()
    .map(|key| {
        (
            key.to_owned(),
            serde_json::json!(
                std::env::var_os(key).map(|value| crate::diagnostics::os_value(&value))
            ),
        )
    })
    .collect::<serde_json::Map<_, _>>()
    .into()
}

pub(crate) struct BrowserLaunchError {
    pub(crate) evidence: serde_json::Value,
    error: anyhow::Error,
}

impl std::fmt::Display for BrowserLaunchError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("browser launch failed")
    }
}

impl std::fmt::Debug for BrowserLaunchError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Display::fmt(self, formatter)
    }
}

impl std::error::Error for BrowserLaunchError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(self.error.as_ref())
    }
}

pub(crate) fn launch_commands(
    url: &str,
    origin: &str,
    commands: Vec<Command>,
) -> anyhow::Result<()> {
    use serde_json::json;
    let started = std::time::Instant::now();
    let mut attempts = Vec::new();
    let mut result = Err(std::io::Error::other("no browser launcher available").into());
    for mut command in commands {
        let mut evidence = json!({"launcher": crate::diagnostics::os_value(command.get_program()), "args": command.get_args().map(crate::diagnostics::os_value).collect::<Vec<_>>()});
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        let child = crate::windows_sockets::spawn(&mut command);
        #[cfg(not(windows))]
        let child = command.spawn();
        let mut child = match child {
            Ok(child) => child,
            Err(error) => {
                evidence["spawn_error"] = error.to_string().into();
                evidence["os_error_code"] = json!(error.raw_os_error());
                attempts.push(evidence);
                result = Err(error.into());
                continue;
            }
        };
        let status = child.wait();
        result = match status {
            Ok(status) => {
                evidence["exit_status"] = status.to_string().into();
                evidence["exit_code"] = json!(status.code());
                #[cfg(unix)]
                {
                    use std::os::unix::process::ExitStatusExt;
                    evidence["signal"] = json!(status.signal());
                }
                if status.success() {
                    Ok(())
                } else {
                    Err(anyhow::anyhow!("browser launcher exited with {status}"))
                }
            }
            Err(error) => {
                evidence["wait_error"] = error.to_string().into();
                evidence["os_error_code"] = json!(error.raw_os_error());
                Err(error.into())
            }
        };
        attempts.push(evidence);
        // Match open::that: only spawn failures advance to the next launcher.
        break;
    }
    let evidence = json!({"url": url, "origin": origin, "desktop": context(), "attempts": attempts, "elapsed_ms": started.elapsed().as_millis() as u64});
    match result {
        Ok(()) => {
            tracing::info!(target: "catserver::diagnostic", browser = %evidence, "Browser launch completed");
            Ok(())
        }
        Err(error) => Err(BrowserLaunchError { evidence, error }.into()),
    }
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    #[test]
    fn browser_diagnostics_preserve_non_unicode_values() {
        use std::{ffi::OsString, os::unix::ffi::OsStringExt, process::Command};
        const TEST: &str = "desktop::tests::browser_diagnostics_preserve_non_unicode_values";
        let raw = vec![b'x', 0xff];
        if std::env::var_os("CATSERVER_EXACT_DESKTOP_TEST").is_none() {
            assert!(
                Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", TEST])
                    .env("CATSERVER_EXACT_DESKTOP_TEST", "1")
                    .env("DISPLAY", OsString::from_vec(raw.clone()))
                    .status()
                    .unwrap()
                    .success()
            );
            return;
        }
        let mut missing = Command::new(OsString::from_vec(raw.clone()));
        missing.arg(OsString::from_vec(raw.clone()));
        let mut command = Command::new("sh");
        command.args([
            "-c",
            "printf '\\377'; head -c 20000 /dev/zero; printf '\\376' >&2; exit 23",
        ]);
        command.arg(OsString::from_vec(raw.clone()));
        let error =
            super::launch_commands("http://localhost", "test", vec![missing, command]).unwrap_err();
        let evidence =
            crate::tracing_setup::failure_evidence(&error, "browser_test")["browser"].clone();
        assert_eq!(
            evidence["desktop"]["DISPLAY"],
            serde_json::json!({"unix_bytes": raw})
        );
        assert_eq!(
            evidence["attempts"][0]["launcher"],
            serde_json::json!({"unix_bytes": raw})
        );
        assert_eq!(
            evidence["attempts"][0]["args"][0],
            serde_json::json!({"unix_bytes": raw})
        );
        assert!(evidence["attempts"][1].get("stdout").is_none());
        assert!(evidence["attempts"][1].get("stderr").is_none());
    }

    #[test]
    fn browser_failure_retains_launcher_and_desktop_evidence() {
        #[cfg(unix)]
        let command = {
            let mut command = std::process::Command::new("sh");
            command.args([
                "-c",
                "printf 'browser stdout'; printf 'browser stderr' >&2; exit 23",
            ]);
            command
        };
        #[cfg(windows)]
        let command = {
            let mut command = std::process::Command::new("cmd");
            command.args([
                "/C",
                "echo browser stdout & echo browser stderr >&2 & exit /b 23",
            ]);
            command
        };
        let error = super::launch_commands(
            "http://127.0.0.1:1234/?full=query",
            "test_browser",
            vec![command],
        )
        .unwrap_err();
        assert!(!format!("{error:?}").contains("full=query"));
        let evidence =
            crate::tracing_setup::failure_evidence(&error, "browser_test")["browser"].clone();
        assert_eq!(evidence["origin"], "test_browser");
        assert_eq!(evidence["url"], "http://127.0.0.1:1234/?full=query");
        let attempt = &evidence["attempts"][0];
        assert_eq!(attempt["exit_code"], 23);
        assert!(attempt.get("stdout").is_none());
        assert!(attempt.get("stderr").is_none());
        for key in [
            "DISPLAY",
            "WAYLAND_DISPLAY",
            "XDG_SESSION_TYPE",
            "DESKTOP_SESSION",
            "XDG_CURRENT_DESKTOP",
        ] {
            assert_eq!(
                evidence["desktop"][key],
                serde_json::json!(
                    std::env::var_os(key).map(|value| crate::diagnostics::os_value(&value))
                )
            );
        }
    }
}

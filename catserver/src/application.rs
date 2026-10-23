use std::time::{Duration, Instant};

use anyhow::Result;
use single_instance::SingleInstance;
use tokio::sync::broadcast::{self, Sender};

use crate::{
    args::{Args, server_config},
    dummy_rotator::DummyRotator,
    hamlib_rotator::HamlibRotator,
    instance_port,
    radio_config::RadioConfig,
    radio_factory,
    radio_manager::RadioManager,
    rotator_config::RotatorConfig,
    rotator_manager::{ActiveRotatorBackend, RotatorManager},
    server::{Server, ServerConfig},
    startup_radio, tray_icon,
    tray_icon::UserEvent,
};

const INSTANCE_NAME: &str = "HolyCluster";

pub fn run(args: Args) -> Result<()> {
    let internal_modes = usize::from(args.apply_update.is_some())
        + usize::from(args.resume_update.is_some())
        + usize::from(args.elevate_update.is_some());
    anyhow::ensure!(
        internal_modes <= 1 && !(internal_modes != 0 && args.close),
        "update launch modes cannot be combined with each other or --close"
    );
    if let Some(plan) = args.elevate_update.as_deref() {
        return crate::updater::run_installer_broker(plan);
    }
    if let Some(plan) = args.apply_update.as_deref() {
        return crate::updater::run_helper(plan);
    }
    crate::diagnostics::phase("singleton_acquisition");
    let instance = SingleInstance::new(INSTANCE_NAME)?;
    // single-instance's Linux socket must not escape into the browser process.
    #[cfg(target_os = "linux")]
    crate::updater::close_inherited_descriptors_on_exec()?;
    tracing::info!("Version tag: {}", env!("VERSION"));
    let port_file = instance_port::path()?;
    if !instance.is_single() {
        anyhow::ensure!(
            args.resume_update.is_none(),
            "another CAT Control instance is already running; update restart cannot take over its port"
        );
        let path = if args.close { "exit" } else { "open" };
        if !args.close {
            tracing::info!("Server is already running");
            if args.no_browser {
                return Ok(());
            }
        }
        return contact_existing_instance(&port_file, path);
    }
    crate::diagnostics::own(&port_file);
    crate::diagnostics::phase("loading_configuration");
    instance_port::clear(&port_file)?;
    if args.close {
        tracing::warn!("No running instance, not closing");
        return Ok(());
    }

    let restart = args
        .resume_update
        .as_deref()
        .map(crate::updater::restart_context)
        .transpose()?;
    let mut server_config = server_config(&args);
    if let Some(context) = &restart {
        server_config.local_port = context.port;
    }
    let path = RadioConfig::config_path()?;
    let radio_config = startup_radio::load(&path);
    if let Some(error) = radio_config.load_error {
        tracing::error!(
            ?error,
            "Radio configuration is invalid; using the platform default for this session"
        );
    }
    let radio = radio(radio_config.config, args.dummy)?;
    let rotator_config = RotatorConfig::config_path()
        .and_then(|path| RotatorConfig::load_from_path(&path))
        .unwrap_or_else(|error| {
            tracing::error!(
                ?error,
                "Rotator configuration is invalid; using unconfigured state"
            );
            RotatorConfig::unconfigured()
        });
    let rotator = RotatorManager::new(rotator_config)?;
    let use_dummy_rotator = args.dummy_rotator;
    let no_browser = args.no_browser;
    let (sender, _) = broadcast::channel::<UserEvent>(10);
    let event_sender = sender.clone();
    let use_local_ui = args.local_ui;
    let tray_receiver = sender.subscribe();
    let thread = std::thread::Builder::new()
        .name("singleton".into())
        .spawn(move || {
            let quit_sender = event_sender.clone();
            let result = run_singleton(
                event_sender,
                radio,
                rotator,
                server_config,
                use_local_ui,
                use_dummy_rotator,
                no_browser,
                restart,
            );
            if let Err(error) = &result {
                tracing::error!(?error, failure_evidence = %serde_json::json!(crate::tracing_setup::failure_evidence(error, "singleton")), "Singleton instance failed");
                let _ = quit_sender.send(UserEvent::Quit);
            }
            result
        })?;
    if cfg!(any(windows, target_os = "linux")) {
        tray_icon::run_tray_icon(sender.clone(), tray_receiver);
    }
    let result = match thread.join() {
        Ok(result) => result,
        Err(error) => {
            let message = error
                .downcast_ref::<&str>()
                .copied()
                .or_else(|| error.downcast_ref::<String>().map(String::as_str))
                .unwrap_or("unknown panic payload");
            Err(anyhow::anyhow!("Singleton thread panicked: {message}"))
        }
    };
    crate::diagnostics::phase("shutdown");
    instance_port::clear(&port_file)?;
    let shutdown_reason = result?;
    // Keep singleton ownership while Linux prepares and activates the update.
    // Successful exec releases the close-on-exec lock; failed exec retains it
    // until rollback has completed. Windows helpers still wait for parent exit.
    crate::diagnostics::phase("update_activation");
    crate::updater::exec_pending_update(shutdown_reason)?;
    drop(instance);
    Ok(())
}

pub(crate) fn contact_existing_instance(port_file: &std::path::Path, action: &str) -> Result<()> {
    use anyhow::Context;
    use serde_json::json;
    let started = Instant::now();
    let deadline = started + Duration::from_secs(3);
    let mut attempts = Vec::new();
    let result = (|| -> Result<()> {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_millis(500))
            .build()?;
        loop {
            let mut attempt = json!({
                "attempt": attempts.len() + 1,
                "elapsed_ms": started.elapsed().as_millis() as u64,
                "instance": crate::diagnostics::instance_evidence(port_file),
            });
            match instance_port::read(port_file) {
                Ok(port) => {
                    attempt["port"] = port.into();
                    match client
                        .post(format!("http://127.0.0.1:{port}/{action}"))
                        .send()
                    {
                        Ok(response) => {
                            attempt["http_status"] = response.status().as_u16().into();
                            attempts.push(attempt);
                            response.error_for_status()?;
                            return Ok(());
                        }
                        Err(error) => {
                            attempt["connect_error"] = error.to_string().into();
                            attempts.push(attempt);
                            if Instant::now() >= deadline {
                                return Err(error.into());
                            }
                        }
                    }
                }
                Err(error) => {
                    attempt["read_error"] = format!("{error:#}").into();
                    attempts.push(attempt);
                }
            }
            if Instant::now() >= deadline {
                anyhow::bail!("running catserver did not publish a reachable local port");
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    })();
    let evidence = json!({"action": action, "elapsed_ms": started.elapsed().as_millis() as u64, "attempts": attempts});
    tracing::info!(target: "catserver::diagnostic", evidence = %evidence, success = result.is_ok(), "Existing instance contact completed");
    result.with_context(|| format!("existing instance contact: {evidence}"))
}

fn radio(config: RadioConfig, use_dummy: bool) -> Result<RadioManager> {
    let selected = config.effective_backend(use_dummy);
    Ok(RadioManager::new(config, selected)?)
}

fn open_browser(port: u16, origin: &str) -> Result<()> {
    let url = format!("http://127.0.0.1:{port}");
    let commands = open::commands(&url);
    #[cfg(windows)]
    let commands = commands.into_iter().rev().take(1).collect();
    crate::desktop::launch_commands(&url, origin, commands)
}

#[tokio::main]
#[allow(clippy::too_many_arguments)]
async fn run_singleton(
    sender: Sender<UserEvent>,
    radio: RadioManager,
    rotator: RotatorManager,
    server_config: ServerConfig,
    use_local_ui: bool,
    use_dummy_rotator: bool,
    no_browser: bool,
    restart: Option<crate::updater::RestartContext>,
) -> Result<UserEvent> {
    crate::diagnostics::phase("radio_initialization");
    let snapshot = radio.snapshot();
    let selected = snapshot.selected.clone();
    let factory = radio_factory::factory(snapshot.config.clone(), selected.clone());
    radio
        .replace(snapshot.config, selected, move || factory())
        .await?;
    let snapshot = radio.snapshot();
    tracing::info!(?snapshot.connection, ?snapshot.selected, "Radio startup completed");
    crate::diagnostics::phase("rotator_initialization");
    let active_rotator_config = rotator.snapshot().config;
    if use_dummy_rotator {
        rotator
            .replace(
                active_rotator_config,
                ActiveRotatorBackend::DummyOverride,
                || Box::new(DummyRotator::new()),
            )
            .await?;
    } else if let Some(config) = active_rotator_config.hamlib().cloned() {
        let selected = ActiveRotatorBackend::Configured(config.clone());
        rotator
            .replace(active_rotator_config, selected, move || {
                Box::new(HamlibRotator::new(config.clone()))
            })
            .await?;
    }
    let rotator_snapshot = rotator.snapshot();
    tracing::info!(
        ?rotator_snapshot.connection,
        selected = %rotator_snapshot.selected,
        "Rotator startup completed"
    );
    let mut receiver = sender.subscribe();
    let shutdown_radio = radio.clone();
    let shutdown_rotator = rotator.clone();
    let silent = restart.is_some() || no_browser;
    crate::diagnostics::phase("server_binding");
    let building =
        Server::build_server(sender, radio, rotator, server_config, use_local_ui, restart);
    tokio::pin!(building);
    let server = loop {
        tokio::select! {
            result = &mut building => break result?,
            event = receiver.recv() => {
                if matches!(event, Ok(event) if event.is_shutdown()) {
                    return Ok(UserEvent::Quit);
                }
            }
        }
    };
    let local_port = server.local_port()?;
    instance_port::publish(&instance_port::path()?, local_port)?;
    crate::diagnostics::port(local_port);
    crate::diagnostics::phase("serving");
    if !silent && let Err(error) = open_browser(local_port, "startup") {
        tracing::error!(?error, failure_evidence = %serde_json::json!(crate::tracing_setup::failure_evidence(&error, "browser_startup")), "Failed to open browser on startup");
    }
    tokio::spawn(async move {
        while let Ok(event) = receiver.recv().await {
            match event {
                UserEvent::Quit | UserEvent::RestartForUpdate => break,
                UserEvent::OpenBrowser(origin) => {
                    if let Err(error) = open_browser(local_port, origin) {
                        tracing::error!(?error, failure_evidence = %serde_json::json!(crate::tracing_setup::failure_evidence(&error, "browser_user_event")), "Failed to open browser from user event");
                    }
                }
            }
        }
    });
    tracing::info!("Running webapp");
    let result = server.run_server().await;
    crate::diagnostics::phase("device_shutdown");
    shutdown_radio.shutdown().await?;
    shutdown_rotator.shutdown().await?;
    result
}

#[cfg(test)]
mod singleton_diagnostic_tests {
    #[test]
    fn failed_contact_retains_http_attempt_and_owner_evidence() {
        use std::io::{Read, Write};
        let directory = tempfile::tempdir().unwrap();
        let port_file = directory.path().join("instance-port");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        crate::instance_port::publish(&port_file, listener.local_addr().unwrap().port()).unwrap();
        std::fs::write(
            directory.path().join("instance-owner.json"),
            r#"{"pid":123,"lifecycle_phase":"serving"}"#,
        )
        .unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            assert!(stream.read(&mut request).unwrap() > 0);
            stream
                .write_all(b"HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\n\r\n")
                .unwrap();
        });
        let error = super::contact_existing_instance(&port_file, "open").unwrap_err();
        server.join().unwrap();
        let text = format!("{error:#}");
        for expected in [
            "attempts",
            "owner_state",
            "123",
            "elapsed_ms",
            "503",
            "open",
            "port_file_age_ms",
        ] {
            assert!(text.contains(expected), "missing {expected}: {text}");
        }
    }
}

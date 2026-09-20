use anyhow::Result;
use single_instance::SingleInstance;
use tokio::sync::broadcast::{self, Sender};

use crate::{
    args::{Args, BASE_LOCAL_PORT, server_config},
    dummy_rotator::DummyRotator,
    hamlib_rotator::HamlibRotator,
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
    if let Some(plan) = args.apply_update.as_deref() {
        return crate::updater::run_helper(plan);
    }
    let instance = SingleInstance::new(INSTANCE_NAME)?;
    tracing::info!("Version tag: {}", env!("VERSION"));
    let server_config = server_config(&args);
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
    let is_single = instance.is_single();
    if is_single {
        if args.close {
            tracing::warn!("No running instance, not closing");
            return Ok(());
        }
        let (sender, _) = broadcast::channel::<UserEvent>(10);
        let event_sender = sender.clone();
        let use_local_ui = args.local_ui;
        let thread = std::thread::Builder::new()
            .name("singleton".into())
            .spawn(move || {
                if let Err(error) = run_singleton(
                    event_sender,
                    radio,
                    rotator,
                    server_config,
                    use_local_ui,
                    use_dummy_rotator,
                ) {
                    tracing::error!(?error, "Singleton instance failed");
                }
            })?;
        if cfg!(any(windows, target_os = "linux")) {
            tray_icon::run_tray_icon(sender.clone(), sender.subscribe());
        }
        if let Err(error) = thread.join() {
            let message = error
                .downcast_ref::<&str>()
                .copied()
                .or_else(|| error.downcast_ref::<String>().map(String::as_str))
                .unwrap_or("unknown panic payload");
            tracing::error!(message, "Singleton thread panicked");
        }
    } else {
        let path = if args.close { "exit" } else { "open" };
        if !args.close {
            tracing::info!("Server is already running");
        }
        reqwest::blocking::Client::new()
            .post(format!("http://127.0.0.1:{BASE_LOCAL_PORT}/{path}"))
            .send()?;
    }
    drop(instance);
    if is_single {
        crate::updater::exec_pending_update()?;
    }
    Ok(())
}

fn radio(config: RadioConfig, use_dummy: bool) -> Result<RadioManager> {
    let selected = config.effective_backend(use_dummy);
    Ok(RadioManager::new(config, selected)?)
}

fn open_browser(port: u16) -> Result<()> {
    open::that(format!("http://127.0.0.1:{port}"))?;
    Ok(())
}

#[tokio::main]
async fn run_singleton(
    sender: Sender<UserEvent>,
    radio: RadioManager,
    rotator: RotatorManager,
    server_config: ServerConfig,
    use_local_ui: bool,
    use_dummy_rotator: bool,
) -> Result<()> {
    let snapshot = radio.snapshot();
    let selected = snapshot.selected.clone();
    let factory = radio_factory::factory(snapshot.config.clone(), selected.clone());
    radio
        .replace(snapshot.config, selected, move || factory())
        .await?;
    let snapshot = radio.snapshot();
    tracing::info!(?snapshot.connection, ?snapshot.selected, "Radio startup completed");
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
    let local_port = server_config.local_port;
    let mut receiver = sender.subscribe();
    let shutdown_radio = radio.clone();
    let shutdown_rotator = rotator.clone();
    let server = Server::build_server(sender, radio, rotator, server_config, use_local_ui).await?;
    open_browser(local_port)?;
    tokio::spawn(async move {
        while let Ok(event) = receiver.recv().await {
            match event {
                UserEvent::Quit => break,
                UserEvent::OpenBrowser => {
                    if let Err(error) = open_browser(local_port) {
                        tracing::error!(?error, "Failed to open browser from user event");
                    }
                }
            }
        }
    });
    tracing::info!("Running webapp");
    let result = server.run_server().await;
    shutdown_radio.shutdown().await?;
    shutdown_rotator.shutdown().await?;
    result
}

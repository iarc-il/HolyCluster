use anyhow::Result;
use single_instance::SingleInstance;
use tokio::sync::broadcast::{self, Sender};

use crate::{
    args::{Args, BASE_LOCAL_PORT, rigctld_endpoint, server_config},
    dummy_rotator::DummyRotator,
    radio_config::RadioConfig,
    radio_factory,
    radio_manager::RadioManager,
    rotator::AnyRotator,
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
    let rigctld_endpoint = rigctld_endpoint(&args);
    let radio = radio(radio_config.config, args.dummy)?;
    let rotator = rotator(args.dummy_rotator);
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
                    rigctld_endpoint,
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

fn rotator(use_dummy: bool) -> AnyRotator {
    if use_dummy {
        return AnyRotator::new(DummyRotator::new());
    }
    #[cfg(windows)]
    {
        AnyRotator::new(crate::pstrotator::PstRotator::new())
    }
    #[cfg(not(windows))]
    {
        AnyRotator::new(crate::rotctld::RotctldRotator::new(
            "localhost".into(),
            4533,
        ))
    }
}

fn open_browser(port: u16) -> Result<()> {
    open::that(format!("http://127.0.0.1:{port}"))?;
    Ok(())
}

#[tokio::main]
async fn run_singleton(
    sender: Sender<UserEvent>,
    radio: RadioManager,
    rotator: AnyRotator,
    server_config: ServerConfig,
    use_local_ui: bool,
    rigctld_endpoint: (String, u16),
) -> Result<()> {
    let snapshot = radio.snapshot();
    let selected = snapshot.selected.clone();
    let factory =
        radio_factory::factory(snapshot.config.clone(), selected.clone(), rigctld_endpoint);
    radio
        .replace(snapshot.config, selected, move || factory())
        .await?;
    let snapshot = radio.snapshot();
    tracing::info!(?snapshot.connection, ?snapshot.selected, "Radio startup completed");
    tracing::info!("Initializing {} rotator", rotator.read().get_name());
    rotator.write().init();
    if rotator.is_available() {
        tracing::info!("Rotator initialized successfully");
    } else {
        tracing::warn!("Rotator initialization failed, continuing without rotator support");
    }
    let local_port = server_config.local_port;
    let mut receiver = sender.subscribe();
    let shutdown_radio = radio.clone();
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
    result
}

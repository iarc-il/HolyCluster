#![windows_subsystem = "windows"]
use std::fs::OpenOptions;

use anyhow::Result;
use argh::FromArgs;
use directories::ProjectDirs;
use server::{Server, ServerConfig};
use single_instance::SingleInstance;
use tokio::sync::broadcast::{self, Receiver};

mod dummy;
mod freq;
#[cfg(windows)]
mod omnirig;
mod rig;
mod server;
mod tray_icon;
mod utils;

use dummy::DummyRadio;
use rig::AnyRadio;
use tracing::level_filters::LevelFilter;
use tracing_subscriber::{EnvFilter, Layer, Registry, layer::SubscriberExt};
use tray_icon::IconTrayEvent;

const BASE_LOCAL_PORT: u16 = 3000;

fn open_at_browser(port: u16) -> Result<()> {
    let address = format!("http://127.0.0.1:{port}");
    tracing::info!("Opening browser at: {address}");
    open::that(address)?;
    Ok(())
}

#[derive(FromArgs)]
/// The Holy Cluster - debug flags
#[argh(help_triggers("-h", "--help"))]
struct Args {
    /// run the server with the UI from the development server
    #[argh(switch)]
    dev_server: bool,

    /// run with dummy radio instead of omnirig
    #[argh(switch)]
    dummy: bool,

    /// search for local ui dist dir instead of using remote server
    #[argh(switch)]
    local_ui: bool,
}

#[cfg(windows)]
fn get_radio(use_dummy: bool) -> AnyRadio {
    use omnirig::OmnirigRadio;

    if use_dummy {
        AnyRadio::new(DummyRadio::new())
    } else {
        AnyRadio::new(OmnirigRadio::new())
    }
}

#[cfg(not(windows))]
fn get_radio(use_dummy: bool) -> AnyRadio {
    if use_dummy {
        tracing::warn!("DUMMY env variable doesn't have any affect in linux!");
    }
    AnyRadio::new(DummyRadio::new())
}

/// For development purposes, we run each instance in different port, based on the given arguments
fn get_port_from_args(base_port: u16, args: &Args) -> u16 {
    let mut port = base_port;
    if args.dev_server {
        port += 1;
    }
    if args.dummy {
        port += 2;
    }
    if args.local_ui {
        port += 4;
    }
    port
}

fn get_slug_from_args(args: &Args) -> String {
    let mut slug = vec![];
    if args.dev_server {
        slug.push("dev_server");
    }
    if args.dummy {
        slug.push("dummy");
    }
    if args.local_ui {
        slug.push("local_ui");
    }
    slug.join("-")
}

fn configure_tracing() {
    let project_dirs = ProjectDirs::from("org", "iarc", "holycluster").unwrap();
    let cache_dir = project_dirs.cache_dir();
    std::fs::create_dir_all(cache_dir).unwrap();
    let log_path = cache_dir.join("debug.log");

    let debug_file = OpenOptions::new()
        .append(true)
        .create(true)
        .open(log_path)
        .unwrap();

    let log_file_filter = EnvFilter::builder()
        .with_default_directive(LevelFilter::INFO.into())
        .from_env()
        .unwrap()
        .add_directive("catserver=debug".parse().unwrap());

    let subscriber = Registry::default()
        .with(
            tracing_subscriber::fmt::layer()
                .compact()
                .with_ansi(!cfg!(windows))
                .with_filter(tracing_subscriber::filter::LevelFilter::from_level(
                    tracing::Level::INFO,
                )),
        )
        .with(
            tracing_subscriber::fmt::layer()
                .compact()
                .with_writer(debug_file)
                .with_filter(log_file_filter),
        );

    tracing::subscriber::set_global_default(subscriber).unwrap();
}

fn main() -> Result<()> {
    configure_tracing();

    let args: Args = argh::from_env();
    let args_slug = get_slug_from_args(&args);
    let local_port = get_port_from_args(BASE_LOCAL_PORT, &args);

    let instance = SingleInstance::new(&format!("HolyCluster-{args_slug}"))?;

    let server_config = if args.dev_server {
        tracing::info!("Using dev server");
        ServerConfig {
            dns: "holycluster-dev.iarc.org".into(),
            is_using_ssl: false,
            local_port,
        }
    } else {
        tracing::info!("Using production server");
        ServerConfig {
            dns: "holycluster.iarc.org".into(),
            is_using_ssl: true,
            local_port,
        }
    };

    let radio = get_radio(args.dummy);

    if instance.is_single() {
        let (tray_sender, tray_receiver) = broadcast::channel::<IconTrayEvent>(10);
        let quit_reciever = tray_sender.subscribe();

        let use_local_ui = args.local_ui;
        let thread = std::thread::Builder::new()
            .name("singleton".into())
            .spawn(move || {
                run_singleton_instance(
                    quit_reciever,
                    tray_receiver,
                    radio,
                    server_config,
                    use_local_ui,
                )
                .unwrap();
            })?;

        // Currently we don't care about tray icon for linux because it's only used for development.
        // This can be enabled if we ever support linux for users.
        if cfg!(windows) {
            tray_icon::run_tray_icon(&args_slug, tray_sender);
        } else {
            thread.join().unwrap();
        }
    } else {
        tracing::info!("Server is already running");
        open_at_browser(local_port)?;
    }
    Ok(())
}

#[tokio::main]
async fn run_singleton_instance(
    quit_receiver: Receiver<IconTrayEvent>,
    mut tray_receiver: Receiver<IconTrayEvent>,
    radio: AnyRadio,
    server_config: ServerConfig,
    use_local_ui: bool,
) -> Result<()> {
    tracing::info!("Initializing {} radio", radio.read().get_name());
    radio.write().init();
    tracing::info!("Radio initialized");

    let local_port = server_config.local_port;
    let server = Server::build_server(radio, server_config, use_local_ui).await?;
    open_at_browser(local_port)?;

    tokio::spawn(async move {
        while let Ok(message) = tray_receiver.recv().await {
            if message == IconTrayEvent::OpenBrowser {
                open_at_browser(local_port).unwrap();
            }
        }
    });

    tracing::info!("Running webapp");
    server.run_server(quit_receiver).await?;

    Ok(())
}

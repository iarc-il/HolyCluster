#![cfg_attr(not(feature = "dev_server"), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use tracing_panic::panic_hook;

use anyhow::Result;
use argh::FromArgs;
use directories::ProjectDirs;
use server::{Server, ServerConfig};
use single_instance::SingleInstance;
use tokio::sync::broadcast::{self, Sender};

mod dummy;
mod freq;
#[cfg(windows)]
mod omnirig;
mod rig;
#[cfg(not(windows))]
mod rigctld;
mod server;
mod tray_icon;
mod utils;

use dummy::DummyRadio;
#[cfg(windows)]
use omnirig::OmnirigRadio;
use rig::AnyRadio;
#[cfg(not(windows))]
use rigctld::RigctldRadio;
use tracing::level_filters::LevelFilter;
use tracing_subscriber::{EnvFilter, Layer, Registry, layer::SubscriberExt};
use tray_icon::UserEvent;

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
    /// run with dummy radio instead of real radio
    #[argh(switch)]
    dummy: bool,

    /// search for local ui dist dir instead of using remote server
    #[argh(switch)]
    local_ui: bool,

    /// closes the running instance
    #[argh(switch)]
    close: bool,
}

#[cfg(windows)]
fn get_radio(use_dummy: bool) -> AnyRadio {
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
        AnyRadio::new(DummyRadio::new())
    } else {
        AnyRadio::new(RigctldRadio::new("localhost".into(), 4532))
    }
}

/// For development purposes, we run each instance in different port, based on the given arguments
fn get_port_from_args(base_port: u16, args: &Args, use_dev_server: bool) -> u16 {
    let mut port = base_port;
    if use_dev_server {
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

fn get_slug_from_args(args: &Args, use_dev_server: bool) -> String {
    let mut slug = vec![];
    if use_dev_server {
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
    std::panic::set_hook(Box::new(panic_hook));

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
    let use_dev_server = cfg!(feature = "dev_server");
    let args_slug = get_slug_from_args(&args, use_dev_server);
    let local_port = get_port_from_args(BASE_LOCAL_PORT, &args, use_dev_server);

    let instance = SingleInstance::new(&format!("HolyCluster-{args_slug}"))?;

    tracing::info!("Version tag: {}", env!("VERSION"));

    let server_config = if use_dev_server {
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
                run_singleton_instance(event_sender, radio, server_config, use_local_ui).unwrap();
            })?;

        // Currently we don't care about tray icon for linux because it's only used for development.
        // This can be enabled if we ever support linux for users.
        if cfg!(windows) {
            let receiver = sender.subscribe();
            tray_icon::run_tray_icon(&args_slug, sender, receiver);
        } else {
            thread.join().unwrap();
        }
    } else if args.close {
        let client = reqwest::blocking::Client::new();
        let exit_uri = format!("http://127.0.0.1:{local_port}/exit");
        client.post(exit_uri).send()?;
    } else {
        tracing::info!("Server is already running");
        open_at_browser(local_port)?;
    }
    Ok(())
}

#[tokio::main]
async fn run_singleton_instance(
    sender: Sender<UserEvent>,
    radio: AnyRadio,
    server_config: ServerConfig,
    use_local_ui: bool,
) -> Result<()> {
    tracing::info!("Initializing {} radio", radio.read().get_name());
    radio.write().init();
    tracing::info!("Radio initialized");

    let local_port = server_config.local_port;

    let (browser_sender, mut broswer_receiver) = tokio::sync::mpsc::channel::<UserEvent>(10);

    let server =
        Server::build_server(sender, browser_sender, radio, server_config, use_local_ui).await?;
    open_at_browser(local_port)?;

    tokio::spawn(async move {
        while let Some(message) = broswer_receiver.recv().await {
            match message {
                UserEvent::Quit => {
                    break;
                }
                UserEvent::OpenBrowser => {
                    open_at_browser(local_port).unwrap();
                }
            }
        }
    });

    tracing::info!("Running webapp");
    server.run_server().await?;

    Ok(())
}

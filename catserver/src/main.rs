#![windows_subsystem = "windows"]

use anyhow::Result;
use argh::FromArgs;
use server::{RemoteServer, Server};
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
use tray_icon::IconTrayEvent;

pub const LOCAL_PORT: u16 = 3000;

fn open_at_browser() -> Result<()> {
    open::that(format!("http://127.0.0.1:{LOCAL_PORT}"))?;
    Ok(())
}

#[derive(FromArgs)]
/// Holy Cluster
#[argh(help_triggers("-h", "--help"))]
struct Args {
    /// run the server with the UI from the production server
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
        println!("Using omnirig");
        AnyRadio::new(OmnirigRadio::new())
    }
}

#[cfg(not(windows))]
fn get_radio(use_dummy: bool) -> AnyRadio {
    if use_dummy {
        println!("DUMMY env variable doesn't have any affect in linux!");
    }
    AnyRadio::new(DummyRadio::new())
}

fn main() -> Result<()> {
    let args: Args = argh::from_env();

    let instance = SingleInstance::new("HolyCluster")?;

    let remote_server = if args.dev_server {
        RemoteServer {
            dns: "holycluster-dev.iarc.org".into(),
            is_using_ssl: false,
        }
    } else {
        RemoteServer {
            dns: "holycluster.iarc.org".into(),
            is_using_ssl: true,
        }
    };

    let radio = get_radio(args.dummy);

    if instance.is_single() {
        let (tray_sender, tray_receiver) = broadcast::channel::<IconTrayEvent>(10);
        let quit_reciever = tray_sender.subscribe();

        let use_local_ui = args.local_ui;
        let _thread = std::thread::Builder::new()
            .name("tray-icon".into())
            .spawn(move || {
                run_singleton_instance(
                    quit_reciever,
                    tray_receiver,
                    radio,
                    remote_server,
                    use_local_ui,
                )
                .unwrap();
            });
        tray_icon::run_tray_icon(tray_sender);
    } else {
        open_at_browser()?;
    }
    Ok(())
}

#[tokio::main]
async fn run_singleton_instance(
    quit_receiver: Receiver<IconTrayEvent>,
    mut tray_receiver: Receiver<IconTrayEvent>,
    radio: AnyRadio,
    remote_server: RemoteServer,
    use_local_ui: bool,
) -> Result<()> {
    radio.write().init();

    println!("Radio initialized");

    let server = Server::build_server(radio, remote_server, use_local_ui).await?;

    open_at_browser()?;

    tokio::spawn(async move {
        while let Ok(message) = tray_receiver.recv().await {
            if message == IconTrayEvent::OpenBrowser {
                open_at_browser().unwrap();
            }
        }
    });

    println!("Running webapp");
    server.run_server(quit_receiver).await?;

    Ok(())
}

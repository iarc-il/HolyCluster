#![windows_subsystem = "windows"]

use anyhow::Result;
use server::{RemoteServer, Server};
use single_instance::SingleInstance;
use tokio::sync::broadcast::{self, Receiver};

mod dummy;
mod freq;
mod omnirig;
mod rig;
mod server;
mod tray_icon;
mod utils;

use dummy::DummyRadio;
use rig::AnyRadio;
use tray_icon::IconTrayEvent;

pub const LOCAL_PORT: u16 = 3000;

const HOLY_CLUSTER_DNS: &str = "holycluster.iarc.org";
const IS_USING_SSL: bool = true;

fn open_at_browser() -> Result<()> {
    open::that(format!("http://127.0.0.1:{LOCAL_PORT}"))?;
    Ok(())
}

fn main() -> Result<()> {
    let instance = SingleInstance::new("HolyCluster")?;

    let remote_server = RemoteServer {
        dns: HOLY_CLUSTER_DNS.into(),
        is_using_ssl: IS_USING_SSL,
    };
    if instance.is_single() {
        let (tray_sender, tray_receiver) = broadcast::channel::<IconTrayEvent>(10);
        let quit_reciever = tray_sender.subscribe();

        let _thread = std::thread::Builder::new()
            .name("tray-icon".into())
            .spawn(|| {
                run_singleton_instance(quit_reciever, tray_receiver, remote_server).unwrap();
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
    remote_server: RemoteServer,
) -> Result<()> {
    let radio = if cfg!(windows) {
        use omnirig::OmnirigRadio;

        if std::env::var("DUMMY").is_ok() {
            AnyRadio::new(DummyRadio::new())
        } else {
            println!("Using omnirig");
            AnyRadio::new(OmnirigRadio::new())
        }
    } else {
        if std::env::var("DUMMY").is_ok() {
            println!("DUMMY env variable doesn't have any affect in linux!");
        }
        AnyRadio::new(DummyRadio::new())
    };
    radio.write().init();

    println!("Radio initialized");

    let server = Server::build_server(radio, remote_server).await?;

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

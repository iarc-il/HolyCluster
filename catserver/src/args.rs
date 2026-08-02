use argh::FromArgs;

use crate::server::ServerConfig;

pub const BASE_LOCAL_PORT: u16 = 3000;

#[derive(FromArgs)]
/// The Holy Cluster - debug flags
#[argh(help_triggers("-h", "--help"))]
pub struct Args {
    /// use the development HolyCluster server
    #[argh(switch)]
    pub dev_server: bool,
    /// run with dummy radio instead of real radio
    #[argh(switch)]
    pub dummy: bool,
    /// run with dummy rotator instead of real rotator
    #[argh(switch)]
    pub dummy_rotator: bool,
    /// search for local ui dist dir instead of using remote server
    #[argh(switch)]
    pub local_ui: bool,
    /// port for local connection
    #[argh(option)]
    pub port: Option<u16>,
    /// closes the running instance
    #[argh(switch)]
    pub close: bool,
}

pub fn server_config(args: &Args) -> ServerConfig {
    let local_port = args.port.unwrap_or(BASE_LOCAL_PORT);
    let dns = if args.dev_server {
        "holycluster-dev.iarc.org"
    } else {
        "holycluster.iarc.org"
    };
    ServerConfig {
        dns: dns.into(),
        is_using_ssl: true,
        local_port,
    }
}

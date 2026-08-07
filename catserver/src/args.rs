use std::path::PathBuf;

use argh::FromArgs;

use crate::server::ServerConfig;

pub const BASE_LOCAL_PORT: u16 = 3000;
pub const DEFAULT_RIGCTLD_HOST: &str = "127.0.0.1";
pub const DEFAULT_RIGCTLD_PORT: u16 = 4532;

#[derive(FromArgs)]
/// The Holy Cluster - debug flags
#[argh(help_triggers("-h", "--help"))]
pub struct Args {
    /// use the development HolyCluster server
    #[argh(switch)]
    pub dev_server: bool,
    /// backend host:port (overrides dev_server)
    #[argh(option)]
    pub backend: Option<String>,
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
    /// rigctld host
    #[argh(option)]
    pub rigctld_host: Option<String>,
    /// rigctld port
    #[argh(option)]
    pub rigctld_port: Option<u16>,
    /// closes the running instance
    #[argh(switch)]
    pub close: bool,
    /// internal detached update helper plan
    #[argh(option, hidden_help)]
    pub apply_update: Option<PathBuf>,
}

pub fn server_config(args: &Args) -> ServerConfig {
    let local_port = args.port.unwrap_or(BASE_LOCAL_PORT);
    let (dns, is_using_ssl) = if let Some(backend) = &args.backend {
        let is_local = backend.starts_with("127.0.0.1") || backend.starts_with("localhost");
        (backend.clone(), !is_local)
    } else if args.dev_server {
        ("holycluster-dev.iarc.org".into(), true)
    } else {
        ("holycluster.iarc.org".into(), true)
    };
    ServerConfig {
        dns,
        is_using_ssl,
        local_port,
    }
}

pub fn rigctld_endpoint(args: &Args) -> (String, u16) {
    (
        args.rigctld_host
            .clone()
            .unwrap_or_else(|| DEFAULT_RIGCTLD_HOST.into()),
        args.rigctld_port.unwrap_or(DEFAULT_RIGCTLD_PORT),
    )
}

use std::path::PathBuf;

use argh::FromArgs;

use crate::server::ServerConfig;

pub const BASE_LOCAL_PORT: u16 = 3000;
pub const DEFAULT_RIGCTLD_HOST: &str = "127.0.0.1";
pub const DEFAULT_RIGCTLD_PORT: u16 = 4532;
pub const PROD_SERVER: &str = "holycluster.iarc.org";
pub const DEV_SERVER: &str = "holycluster-dev.iarc.org";

#[derive(FromArgs)]
/// The Holy Cluster - debug flags
#[argh(help_triggers("-h", "--help"))]
pub struct Args {
    /// hostname of the HolyCluster server to use, e.g. holycluster-int.iarc.org
    #[argh(option)]
    pub server: Option<String>,
    /// use the development HolyCluster server (deprecated, use --server)
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
    // --server wins over the deprecated --dev-server switch, so an explicit
    // host always beats a shortcut that still carries the old flag.
    let dns = match args.server.as_deref() {
        Some(server) => server,
        None if args.dev_server => DEV_SERVER,
        None => PROD_SERVER,
    };
    ServerConfig {
        dns: dns.into(),
        is_using_ssl: true,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn dns_for(args: &[&str]) -> String {
        let args = Args::from_args(&["catserver"], args).expect("args should parse");
        server_config(&args).dns
    }

    #[test]
    fn defaults_to_the_production_server() {
        assert_eq!(dns_for(&[]), PROD_SERVER);
    }

    #[test]
    fn dev_server_switch_still_selects_the_dev_server() {
        assert_eq!(dns_for(&["--dev-server"]), DEV_SERVER);
    }

    #[test]
    fn server_option_selects_an_arbitrary_host() {
        assert_eq!(
            dns_for(&["--server", "holycluster-int.iarc.org"]),
            "holycluster-int.iarc.org"
        );
    }

    #[test]
    fn server_option_overrides_the_dev_server_switch() {
        assert_eq!(
            dns_for(&["--dev-server", "--server", "holycluster-int.iarc.org"]),
            "holycluster-int.iarc.org"
        );
    }
}

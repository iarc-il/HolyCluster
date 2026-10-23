use std::path::PathBuf;

use argh::FromArgs;

use crate::server::ServerConfig;

pub const BASE_LOCAL_PORT: u16 = 3000;

#[derive(FromArgs)]
/// Holy Cluster CAT Control options
#[argh(help_triggers("-h", "--help"))]
pub struct Args {
    /// use the development HolyCluster server
    #[argh(switch, hidden_help)]
    pub dev_server: bool,
    /// backend host:port (overrides dev_server)
    #[argh(option)]
    pub backend: Option<String>,
    // Older releases preserve launch arguments across self-update.
    /// use the legacy dummy radio override
    #[argh(switch, hidden_help)]
    pub dummy: bool,
    // Older releases preserve launch arguments across self-update.
    /// use the legacy dummy rotator override
    #[argh(switch, hidden_help)]
    pub dummy_rotator: bool,
    /// do not open a browser automatically on startup
    #[argh(switch)]
    pub no_browser: bool,
    // Older releases preserve launch arguments across self-update.
    /// accepted legacy local UI option
    #[argh(switch, hidden_help)]
    pub local_ui: bool,
    /// port for local connection
    #[argh(option)]
    pub listen_port: Option<u16>,
    // Older releases preserve launch arguments across self-update.
    /// deprecated alias for listen-port
    #[argh(option, hidden_help)]
    pub port: Option<u16>,
    /// closes the running instance
    #[argh(switch, hidden_help)]
    pub close: bool,
    /// internal detached update helper plan
    #[argh(option, hidden_help)]
    pub apply_update: Option<PathBuf>,
    /// internal same-origin update restart plan
    #[argh(option, hidden_help)]
    pub resume_update: Option<PathBuf>,
    /// internal isolated MSI elevation broker plan
    #[argh(option, hidden_help)]
    pub elevate_update: Option<PathBuf>,
}

pub fn server_config(args: &Args) -> anyhow::Result<ServerConfig> {
    anyhow::ensure!(
        args.listen_port.is_none() || args.port.is_none(),
        "--listen-port and --port cannot be used together"
    );
    let local_port = args.listen_port.or(args.port).unwrap_or(BASE_LOCAL_PORT);
    let (dns, is_using_ssl) = if let Some(backend) = &args.backend {
        let is_local = backend.starts_with("127.0.0.1") || backend.starts_with("localhost");
        (backend.clone(), !is_local)
    } else if args.dev_server {
        ("holycluster-dev.iarc.org".into(), true)
    } else {
        ("holycluster.iarc.org".into(), true)
    };
    Ok(ServerConfig {
        dns,
        is_using_ssl,
        local_port,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_startup_is_enabled_unless_explicitly_disabled() {
        assert!(!Args::from_args(&["catserver"], &[]).unwrap().no_browser);
        let args = Args::from_args(
            &["catserver"],
            &["--dummy", "--dummy-rotator", "--no-browser"],
        )
        .unwrap();
        assert!(args.no_browser);
        assert!(args.dummy && args.dummy_rotator);
    }

    #[test]
    fn listen_port_defaults_and_alias_are_resolved() {
        let default = Args::from_args(&["catserver"], &[]).unwrap();
        assert_eq!(server_config(&default).unwrap().local_port, BASE_LOCAL_PORT);

        let current = Args::from_args(&["catserver"], &["--listen-port", "41234"]).unwrap();
        assert_eq!(server_config(&current).unwrap().local_port, 41234);

        let legacy = Args::from_args(&["catserver"], &["--port", "41235"]).unwrap();
        assert_eq!(server_config(&legacy).unwrap().local_port, 41235);
    }

    #[test]
    fn help_hides_compatibility_and_internal_options() {
        let Err(help) = Args::from_args(&["catserver"], &["--help"]) else {
            panic!("help must exit argument parsing");
        };
        for visible in ["--backend", "--no-browser", "--listen-port"] {
            assert!(help.output.contains(visible));
        }
        for hidden in [
            "--dummy",
            "--dummy-rotator",
            "--local-ui",
            "--port",
            "--close",
            "--apply-update",
            "--resume-update",
            "--elevate-update",
        ] {
            assert!(!help.output.contains(&format!("  {hidden}")));
        }
    }

    #[test]
    fn listen_port_rejects_the_legacy_alias_when_both_are_present() {
        let args = Args::from_args(
            &["catserver"],
            &["--listen-port", "41234", "--port", "41235"],
        )
        .unwrap();
        assert!(server_config(&args).is_err());
    }
}

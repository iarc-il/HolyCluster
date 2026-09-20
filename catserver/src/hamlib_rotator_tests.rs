use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    sync::{Arc, Mutex},
    thread::JoinHandle,
};

use crate::{
    hamlib_device_config::HamlibDeviceConfig,
    hamlib_rotator::HamlibRotator,
    rotator_config::RotatorConfig,
    rotator_manager::{RotatorConnectionState, RotatorManager},
};

#[tokio::test]
async fn dummy_rotator_operates_through_manager() {
    let manager = RotatorManager::new(RotatorConfig::unconfigured()).unwrap();
    let config = HamlibDeviceConfig {
        model_id: hamlib::RotatorModelId::DUMMY.to_string(),
        token_values: BTreeMap::new(),
    };
    let persisted = RotatorConfig::Hamlib {
        hamlib: config.clone(),
    };
    manager
        .replace(persisted, "hamlib-dummy", move || {
            Box::new(HamlibRotator::new(config.clone()))
        })
        .await
        .unwrap();

    assert_eq!(
        manager.snapshot().connection,
        RotatorConnectionState::Connected
    );
    assert_eq!(manager.status().name, "Hamlib Dummy");
    manager.set_azimuth(270.0).await.unwrap();
    manager.poll_status().await.unwrap();
    assert!(manager.status().azimuth.is_finite());
    manager.shutdown().await.unwrap();
}

struct FakeRotctld {
    address: String,
    commands: Arc<Mutex<Vec<String>>>,
    thread: Option<JoinHandle<()>>,
}

impl FakeRotctld {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap().to_string();
        let commands = Arc::new(Mutex::new(Vec::new()));
        let server_commands = Arc::clone(&commands);
        let thread = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut azimuth = 0.0;
            loop {
                let mut command = String::new();
                if reader.read_line(&mut command).unwrap_or(0) == 0 {
                    break;
                }
                let command = command.trim().to_owned();
                server_commands.lock().unwrap().push(command.clone());
                if command == "\\dump_state" {
                    stream
                        .write_all(
                            b"1\n2\nmin_az=-180\nmax_az=180\nmin_el=0\nmax_el=0\nrot_type=Az\ndone\n",
                        )
                        .unwrap();
                } else if command == "p" {
                    writeln!(stream, "{azimuth}\n0").unwrap();
                } else if let Some(position) = command.strip_prefix("P ") {
                    let mut values = position.split_whitespace();
                    azimuth = values.next().unwrap().parse().unwrap();
                    assert_eq!(values.next(), Some("0.000000"));
                    writeln!(stream, "RPRT 0").unwrap();
                } else if command == "q" {
                    break;
                }
                stream.flush().unwrap();
            }
        });
        Self {
            address,
            commands,
            thread: Some(thread),
        }
    }
}

impl Drop for FakeRotctld {
    fn drop(&mut self) {
        if let Some(thread) = self.thread.take() {
            thread.join().unwrap();
        }
    }
}

#[tokio::test]
async fn net_rotctl_runs_through_hamlib_and_manager() {
    let server = FakeRotctld::start();
    let manager = RotatorManager::new(RotatorConfig::unconfigured()).unwrap();
    let config = HamlibDeviceConfig {
        model_id: hamlib::RotatorModelId::NET_ROTCTL.to_string(),
        token_values: BTreeMap::from([("rot_pathname".into(), server.address.clone())]),
    };
    let persisted = RotatorConfig::Hamlib {
        hamlib: config.clone(),
    };
    manager
        .replace(persisted, "net-rotctl", move || {
            Box::new(HamlibRotator::new(config.clone()))
        })
        .await
        .unwrap();
    assert_eq!(
        manager.snapshot().connection,
        RotatorConnectionState::Connected
    );

    manager.set_azimuth(270.0).await.unwrap();
    manager.poll_status().await.unwrap();
    assert_eq!(manager.status().azimuth, -90.0);
    manager.shutdown().await.unwrap();

    let commands = server.commands.lock().unwrap();
    assert!(commands.iter().any(|command| command == "\\dump_state"));
    assert!(
        commands
            .iter()
            .any(|command| command == "P -90.000000 0.000000")
    );
}

#[tokio::test]
async fn invalid_token_is_rejected_before_replacement() {
    let manager = RotatorManager::new(RotatorConfig::unconfigured()).unwrap();
    let config = HamlibDeviceConfig {
        model_id: hamlib::RotatorModelId::DUMMY.to_string(),
        token_values: BTreeMap::from([("unknown_token".into(), "value".into())]),
    };
    let persisted = RotatorConfig::Hamlib {
        hamlib: config.clone(),
    };

    assert!(
        manager
            .replace(persisted, "hamlib-dummy", move || {
                Box::new(HamlibRotator::new(config.clone()))
            })
            .await
            .is_err()
    );
    assert_eq!(manager.snapshot().selected, "unconfigured");
    manager.shutdown().await.unwrap();
}

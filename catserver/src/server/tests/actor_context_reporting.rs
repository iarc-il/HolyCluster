use std::{
    future::Future,
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Duration,
};

use futures_util::{SinkExt, poll};
use sentry::{Client, ClientOptions};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing_subscriber::layer::SubscriberExt;

use crate::{
    freq::Freq,
    hamlib_radio::HamlibRadio,
    hamlib_radio_tests::{FakeRigctld, net_config},
    radio_config::{
        ActiveRadioBackend, HamlibRigConfig, RadioBackendKind, RadioConfig, RadioRigConfig,
    },
    radio_manager::RadioManager,
    rig::{
        Mode, Radio, RadioBackendContext, RadioInitError, RadioOperationError, Slot, Status,
        UnavailableRadio,
    },
    tracing_setup::{radio_evidence, sentry_event_filter, sentry_options},
};

#[derive(Default)]
struct LocalTransport(Mutex<Vec<Vec<u8>>>);

impl sentry::Transport for LocalTransport {
    fn send_envelope(&self, envelope: sentry::Envelope) {
        let mut bytes = Vec::new();
        envelope.to_writer(&mut bytes).unwrap();
        self.0.lock().unwrap().push(bytes);
    }
}

fn capture(work: impl Future<Output = ()>) -> Vec<serde_json::Value> {
    let transport = Arc::new(LocalTransport::default());
    let client = Arc::new(Client::from(ClientOptions {
        transport: Some(Arc::new(transport.clone())),
        server_name: Some("fabricated-workstation".into()),
        ..sentry_options(Some("http://public@127.0.0.1:1/1")).unwrap()
    }));
    let hub = Arc::new(sentry::Hub::new(
        Some(client),
        Arc::new(sentry::Scope::default()),
    ));
    let subscriber = tracing_subscriber::Registry::default()
        .with(sentry::integrations::tracing::layer().event_filter(sentry_event_filter));
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    sentry::Hub::run(hub, || {
        tracing::subscriber::with_default(subscriber, || runtime.block_on(work))
    });
    transport
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|bytes| {
            let output = std::str::from_utf8(bytes).unwrap();
            assert!(!output.contains("server_name"));
            println!("LOCAL ACTOR ENVELOPE: {output}");
            serde_json::from_str(output.lines().nth(2).unwrap()).unwrap()
        })
        .collect()
}

fn configured(native: &HamlibRigConfig) -> RadioConfig {
    RadioConfig {
        rig: Some(RadioRigConfig {
            model_id: format!("hamlib:{}", native.model_id),
            token_values: native.token_values.clone(),
        }),
    }
}

fn selected() -> ActiveRadioBackend {
    ActiveRadioBackend::Configured(RadioBackendKind::Hamlib)
}

async fn tune(socket: &mut super::session::Socket) {
    tune_mode(socket, "CW", 7050).await;
}

async fn tune_mode(socket: &mut super::session::Socket, mode: &str, freq: u32) {
    socket
        .send(Message::Text(
            serde_json::json!({"version":1,"type":"radio","action":"SetModeAndFreq","mode":mode,"freq":freq})
                .to_string().into(),
        ))
        .await
        .unwrap();
    socket
        .send(Message::Text(
            r#"{"version":1,"type":"radio","action":"GetCapabilities"}"#.into(),
        ))
        .await
        .unwrap();
    super::session::event(socket, "capabilities").await;
}

fn evidence(event: &serde_json::Value) -> serde_json::Value {
    assert_eq!(event["release"], env!("VERSION"));
    assert_eq!(
        event["message"],
        "Failed to process radio WebSocket message"
    );
    serde_json::from_str(
        event["contexts"]["Rust Tracing Fields"]["failure_evidence"]
            .as_str()
            .unwrap(),
    )
    .unwrap()
}

struct ComFailureRadio {
    fail_init: bool,
    untyped_error: bool,
}

impl Radio for ComFailureRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        if !self.fail_init {
            return Ok(());
        }
        let mut context = RadioBackendContext::new("omnirig", "CLSIDFromProgID", false);
        context.hresult = Some(0x80070057);
        Err(RadioInitError::Com {
            message: "setup failed without a hexadecimal text prefix".into(),
            context: Box::new(context),
        })
    }

    fn set_mode(&mut self, _: Mode) -> Result<(), RadioOperationError> {
        let mut context = RadioBackendContext::new("omnirig", "invoke_put", !self.fail_init);
        context.target = Some("Mode");
        context.resolved_mode = Some("CW");
        if !self.fail_init && !self.untyped_error {
            context.hresult = Some(0x80070057);
        }
        Err(RadioOperationError::new(
            1,
            "set mode",
            if self.untyped_error {
                "[0x80070057] unknown library error"
            } else {
                "property failure without a hexadecimal text prefix"
            },
        )
        .with_backend_context(context))
    }

    fn set_frequency(&mut self, _: Slot, _: Freq) -> Result<(), RadioOperationError> {
        unreachable!()
    }

    fn get_status(&mut self) -> Result<Status, RadioOperationError> {
        Ok(Status {
            freq: 7_100_000,
            status: "connected".into(),
            mode: "SSB".into(),
            current_rig: 1,
        })
    }
}

#[test]
fn typed_com_codes_keep_setup_and_property_failures_distinct() {
    let reports = capture(async {
        for (fail_init, untyped_error) in [(true, false), (false, false), (false, true)] {
            let config = RadioConfig { rig: None };
            let selected = ActiveRadioBackend::Configured(RadioBackendKind::Omnirig);
            let radio = RadioManager::new(config.clone(), selected.clone()).unwrap();
            radio
                .replace(config, selected, move || {
                    Box::new(ComFailureRadio {
                        fail_init,
                        untyped_error,
                    })
                })
                .await
                .unwrap();
            let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let (server, _) = super::spawn_catserver_with_radio(
                upstream.local_addr().unwrap(),
                None,
                radio.clone(),
            )
            .await;
            let (mut socket, _) = connect_async(format!("ws://{}/ws", server.address))
                .await
                .unwrap();
            super::session::event(&mut socket, "status").await;
            tune(&mut socket).await;
            socket.close(None).await.unwrap();
            drop(server);
            radio.shutdown().await.unwrap();
        }
    });
    assert_eq!(reports.len(), 3);
    let unknown = evidence(&reports[2]);
    assert!(unknown["hresult"].is_null(), "{unknown}");
    assert!(unknown["backend_call"]["hresult"].is_null());
    let setup = evidence(&reports[0]);
    let call = &setup["pre_operation"]["initialization"]["backend_call"];
    assert_eq!(call["hresult"], 0x80070057u32);
    assert_eq!(call["operation"], "CLSIDFromProgID");
    assert!(setup["backend_call"]["hresult"].is_null());
    assert!(setup["hresult"].is_null());
    let property = evidence(&reports[1]);
    assert_eq!(property["hresult"], 0x80070057u32);
    assert_eq!(property["backend_call"]["operation"], "invoke_put");
    assert_eq!(property["backend_call"]["target"], "Mode");
    assert_eq!(property["backend_call"]["resolved_mode"], "CW");
    assert!(property["pre_operation"]["initialization"]["backend_call"].is_null());
}

#[test]
fn backend_call_evidence_distinguishes_targets_and_resolved_modes() {
    let cases = [
        ("rig_set_vfo", "A", "CW", 7050, "CW", -8),
        ("rig_set_vfo", "A", "CW", 7050, "CW", -5),
        ("rig_set_vfo", "A", "CW", 7050, "CW", -9),
        ("rig_set_vfo", "A", "CW", 7050, "CW", -11),
        ("rig_set_freq", "Current", "CW", 7050, "CW", -8),
        ("rig_set_mode", "Current", "DIGI", 14074, "PKTUSB", -5),
        ("rig_set_mode", "Current", "SSB", 7050, "LSB", -5),
        ("rig_set_mode", "Current", "SSB", 14200, "USB", -5),
    ];
    let reports = capture(async {
        for (operation, _, mode, freq, _, code) in cases {
            let backend =
                FakeRigctld::start(SocketAddr::from(([127, 0, 0, 1], 0)), 7_100_000, "USB");
            backend.select_b();
            let native = net_config(backend.address());
            let config = configured(&native);
            let radio = RadioManager::new(config.clone(), selected()).unwrap();
            radio
                .replace(config, selected(), move || {
                    Box::new(HamlibRadio::new(native.clone()))
                })
                .await
                .unwrap();
            match operation {
                "rig_set_vfo" => backend.fail_vfo(code),
                "rig_set_freq" => backend.fail_frequency(code),
                "rig_set_mode" => backend.fail_mode(code),
                _ => unreachable!(),
            }
            let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let (server, _) = super::spawn_catserver_with_radio(
                upstream.local_addr().unwrap(),
                None,
                radio.clone(),
            )
            .await;
            let (mut socket, _) = connect_async(format!("ws://{}/ws", server.address))
                .await
                .unwrap();
            super::session::event(&mut socket, "status").await;
            tune_mode(&mut socket, mode, freq).await;
            let commands = backend.commands();
            if operation == "rig_set_vfo" {
                assert!(
                    !commands
                        .iter()
                        .any(|command| command.starts_with("F ") || command.starts_with("M ")),
                    "{commands:?}"
                );
            }
            socket.close(None).await.unwrap();
            drop(server);
            radio.shutdown().await.unwrap();
        }
    });
    assert_eq!(reports.len(), cases.len());
    for (report, (operation, target, _, _, mode, code)) in reports.iter().zip(cases) {
        let evidence = evidence(report);
        assert_eq!(
            evidence["backend_call"]["operation"], operation,
            "{evidence}"
        );
        assert_eq!(evidence["backend_call"]["target"], target);
        if operation == "rig_set_mode" {
            assert_eq!(evidence["backend_call"]["resolved_mode"], mode);
        } else {
            assert!(evidence["backend_call"]["resolved_mode"].is_null());
        }
        assert_eq!(evidence["backend_call"]["backend"], "hamlib");
        assert_eq!(evidence["backend_call"]["handle_present"], true);
        assert!(
            report["contexts"]["Rust Tracing Fields"]["error_summary"]
                .as_str()
                .unwrap()
                .contains(&format!("{operation} failed with code {code}:"))
        );
    }
}

#[test]
fn actor_context_distinguishes_preexisting_and_operation_caused_disconnect() {
    let reports = capture(async {
        let backend = FakeRigctld::start(SocketAddr::from(([127, 0, 0, 1], 0)), 7_100_000, "USB");
        let native = net_config(backend.address());
        let config = configured(&native);
        let radio = RadioManager::new(config.clone(), selected()).unwrap();
        radio
            .replace(config, selected(), move || {
                Box::new(HamlibRadio::new(native.clone()))
            })
            .await
            .unwrap();
        backend.fail_mode(-8);
        let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (server, _) =
            super::spawn_catserver_with_radio(upstream.local_addr().unwrap(), None, radio.clone())
                .await;
        let (mut socket, _) = connect_async(format!("ws://{}/ws", server.address))
            .await
            .unwrap();
        super::session::event(&mut socket, "status").await;
        tune(&mut socket).await;
        tune(&mut socket).await;
        socket.close(None).await.unwrap();
        drop(server);
        radio.shutdown().await.unwrap();
    });
    assert_eq!(reports.len(), 2);
    for (report, before) in reports.iter().zip(["connected", "disconnected"]) {
        let fields = &report["contexts"]["Rust Tracing Fields"];
        assert_eq!(fields["device_connected"], false);
        assert!(
            fields["error_summary"]
                .as_str()
                .unwrap()
                .contains("Hamlib rig_set_mode failed with code -8:")
        );
        let evidence = evidence(report);
        assert_eq!(evidence["connection_state"], "disconnected");
        let pre = &evidence["pre_operation"];
        assert_eq!(pre["application_connection_state"], before, "{evidence}");
        assert_eq!(pre["configuration_present"], true);
        assert_eq!(pre["selected_backend"], "hamlib");
        assert_eq!(pre["model_id"], fields["model_id"]);
        assert_eq!(pre["backend_object_present"], true);
        assert_eq!(pre["initialization_failed"], false);
        assert_eq!(pre["initialization"]["outcome"], "succeeded");
        if before == "connected" {
            assert!(pre["disconnect"].is_null());
        } else {
            assert_eq!(pre["disconnect"]["origin"], "command");
            assert_eq!(
                pre["disconnect"]["backend_call"]["operation"],
                "rig_set_mode"
            );
            assert_eq!(pre["disconnect"]["backend_call"]["resolved_mode"], "CW");
        }
    }
}

#[test]
fn recovery_clears_the_previous_disconnect_origin() {
    let reports = capture(async {
        let backend = FakeRigctld::start(SocketAddr::from(([127, 0, 0, 1], 0)), 7_100_000, "USB");
        let native = net_config(backend.address());
        let config = configured(&native);
        let radio = RadioManager::new(config.clone(), selected()).unwrap();
        radio
            .replace(config, selected(), move || {
                Box::new(HamlibRadio::new(native.clone()))
            })
            .await
            .unwrap();
        let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (server, _) =
            super::spawn_catserver_with_radio(upstream.local_addr().unwrap(), None, radio.clone())
                .await;
        let (mut socket, _) = connect_async(format!("ws://{}/ws", server.address))
            .await
            .unwrap();
        super::session::event(&mut socket, "status").await;
        backend.fail_mode(-8);
        tune(&mut socket).await;
        assert_eq!(radio.status().status, "disconnected");
        radio.retry().await.unwrap();
        assert_eq!(radio.status().status, "connected");
        backend.fail_mode(-5);
        tune(&mut socket).await;
        socket.close(None).await.unwrap();
        drop(server);
        radio.shutdown().await.unwrap();
    });
    assert_eq!(reports.len(), 2);
    for report in &reports {
        let evidence = evidence(report);
        assert!(
            evidence["pre_operation"]["disconnect"].is_null(),
            "{evidence}"
        );
        assert_eq!(
            evidence["pre_operation"]["initialization"]["outcome"],
            "succeeded"
        );
        assert_eq!(
            evidence["pre_operation"]["application_connection_state"],
            "connected"
        );
    }
}

#[test]
fn unavailable_reports_keep_initialization_and_disconnect_origins() {
    let reports = capture(async {
        for case in 0..4 {
            let mut backend =
                FakeRigctld::start(SocketAddr::from(([127, 0, 0, 1], 0)), 7_100_000, "USB");
            let mut native = net_config(backend.address());
            if case == 1 {
                native.model_id = "999999".into();
            }
            let config = if case == 0 {
                RadioConfig { rig: None }
            } else {
                configured(&native)
            };
            let selected = config.effective_backend(false);
            let radio = RadioManager::new(config.clone(), selected.clone()).unwrap();
            let factory = crate::radio_factory::factory(config.clone(), selected.clone());
            radio
                .replace(config, selected, move || factory())
                .await
                .unwrap();
            if case >= 2 {
                assert_eq!(radio.status().status, "connected");
                backend.disconnect();
                tokio::time::timeout(Duration::from_secs(3), async {
                    while radio.poll_status().await.status == "connected" {
                        tokio::task::yield_now().await;
                    }
                })
                .await
                .expect("status read detects the closed connection");
                if case == 3 {
                    backend.stop();
                    radio.retry().await.unwrap();
                    assert!(radio.snapshot().last_error.is_some());
                }
            }
            let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let (server, _) = super::spawn_catserver_with_radio(
                upstream.local_addr().unwrap(),
                None,
                radio.clone(),
            )
            .await;
            let (mut socket, _) = connect_async(format!("ws://{}/ws", server.address))
                .await
                .unwrap();
            super::session::event(&mut socket, "status").await;
            tune(&mut socket).await;
            if case == 1 {
                tune(&mut socket).await;
            }
            socket.close(None).await.unwrap();
            drop(server);
            radio.shutdown().await.unwrap();
        }
    });
    assert_eq!(reports.len(), 5);
    let retry = evidence(&reports[4]);
    assert_eq!(
        retry["pre_operation"]["initialization"]["outcome"],
        "failed"
    );
    assert_eq!(
        retry["pre_operation"]["disconnect"]["origin"], "status_read",
        "{retry}"
    );
    assert!(
        retry["pre_operation"]["disconnect"]["error"]
            .as_str()
            .unwrap()
            .contains("read frequency")
    );
    let unconfigured = evidence(&reports[0]);
    assert_eq!(
        unconfigured["pre_operation"]["configuration_present"],
        false
    );
    for report in &reports[1..3] {
        let evidence = evidence(report);
        let pre = &evidence["pre_operation"];
        assert_eq!(pre["initialization"]["outcome"], "failed", "{evidence}");
        assert!(
            pre["initialization"]["error"]
                .as_str()
                .unwrap()
                .contains("initialization failed")
        );
        assert_eq!(pre["disconnect"]["origin"], "initialization");
        assert_eq!(pre["configuration_present"], true);
        assert_eq!(pre["model_id"], "hamlib:999999");
    }
    let disconnected = evidence(&reports[3]);
    let pre = &disconnected["pre_operation"];
    assert_eq!(
        pre["initialization"]["outcome"], "succeeded",
        "{disconnected}"
    );
    assert_eq!(pre["disconnect"]["origin"], "status_read");
    assert!(
        pre["disconnect"]["error"]
            .as_str()
            .unwrap()
            .contains("read frequency")
    );
    assert_eq!(disconnected["backend_call"]["handle_present"], false);
}

#[test]
fn actor_context_distinguishes_missing_backend_from_failed_initialization() {
    let reports = capture(async {
        let config = RadioConfig {
            rig: Some(RadioRigConfig {
                model_id: "hamlib:1".into(),
                token_values: Default::default(),
            }),
        };
        let radio = RadioManager::new(config.clone(), selected()).unwrap();
        let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (server, _) =
            super::spawn_catserver_with_radio(upstream.local_addr().unwrap(), None, radio.clone())
                .await;
        let (mut socket, _) = connect_async(format!("ws://{}/ws", server.address))
            .await
            .unwrap();
        super::session::event(&mut socket, "status").await;
        tune(&mut socket).await;
        radio
            .replace(config, selected(), || {
                Box::new(UnavailableRadio::new("hamlib"))
            })
            .await
            .unwrap();
        tune(&mut socket).await;
        socket.close(None).await.unwrap();
        drop(server);
        radio.shutdown().await.unwrap();
    });
    assert_eq!(reports.len(), 2);
    for (report, initialized) in reports.iter().zip([false, true]) {
        let evidence = evidence(report);
        assert_eq!(evidence["connection_state"], "disconnected");
        let pre = &evidence["pre_operation"];
        assert_eq!(
            pre["application_connection_state"], "disconnected",
            "{evidence}"
        );
        assert_eq!(pre["configuration_present"], true);
        assert_eq!(pre["selected_backend"], "hamlib");
        assert_eq!(pre["model_id"], "hamlib:1");
        assert_eq!(pre["backend_object_present"], initialized);
        assert_eq!(pre["initialization_failed"], initialized);
    }
}

#[tokio::test]
async fn actor_context_stays_with_result_across_queued_replacement() {
    let backend = FakeRigctld::start(SocketAddr::from(([127, 0, 0, 1], 0)), 7_100_000, "USB");
    let native = net_config(backend.address());
    let config = configured(&native);
    let original_model = config.rig.as_ref().unwrap().model_id.clone();
    let radio = RadioManager::new(config.clone(), selected()).unwrap();
    radio
        .replace(config, selected(), move || {
            Box::new(HamlibRadio::new(native.clone()))
        })
        .await
        .unwrap();
    backend.fail_mode(-8);
    let (entered, release, acknowledged) = backend.pause_next_mode();
    let mut operation =
        Box::pin(radio.set_mode_and_frequency(Mode::CW, Freq::from_u32_hz(7_050_000)));
    assert!(poll!(operation.as_mut()).is_pending());
    tokio::time::timeout(Duration::from_secs(3), entered)
        .await
        .unwrap()
        .unwrap();
    let mut replacement =
        Box::pin(
            radio.replace(RadioConfig { rig: None }, ActiveRadioBackend::Dummy, || {
                Box::new(HamlibRadio::new(HamlibRigConfig {
                    model_id: "1".into(),
                    token_values: Default::default(),
                }))
            }),
        );
    // Polling enqueues replacement while the actor is still inside the first backend call.
    assert!(poll!(replacement.as_mut()).is_pending());
    assert!(poll!(operation.as_mut()).is_pending());
    release.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(3), acknowledged)
        .await
        .unwrap()
        .unwrap();
    replacement.await.unwrap();
    let after = radio.snapshot();
    assert!(after.config.rig.is_none());
    assert_eq!(after.selected, ActiveRadioBackend::Dummy);
    assert!(after.last_operation_error.is_none());
    let error = anyhow::Error::new(operation.await.unwrap_err());
    let evidence = radio_evidence(&error, &after, &after, "{}");
    radio.shutdown().await.unwrap();
    assert!(
        error
            .to_string()
            .contains("Hamlib rig_set_mode failed with code -8:")
    );
    let pre = &evidence["pre_operation"];
    assert_eq!(
        pre["application_connection_state"], "connected",
        "{evidence:?}"
    );
    assert_eq!(pre["model_id"], original_model);
    assert_eq!(pre["selected_backend"], "hamlib");
    assert_eq!(pre["configuration_present"], true);
    assert_eq!(pre["backend_object_present"], true);
    assert_eq!(pre["initialization_failed"], false);
    assert_eq!(pre["initialization"]["outcome"], "succeeded");
    assert!(pre["disconnect"].is_null());
    assert_eq!(evidence["backend_call"]["operation"], "rig_set_mode");
    assert_eq!(evidence["backend_call"]["resolved_mode"], "CW");
}

#[tokio::test]
async fn actor_context_uses_execution_state_for_tune_queued_behind_replacement() {
    let backend = FakeRigctld::start(SocketAddr::from(([127, 0, 0, 1], 0)), 7_100_000, "USB");
    let native = net_config(backend.address());
    let config = configured(&native);
    let radio = RadioManager::new(config.clone(), selected()).unwrap();
    radio
        .replace(config, selected(), move || {
            Box::new(HamlibRadio::new(native.clone()))
        })
        .await
        .unwrap();
    backend.fail_mode(-8);
    let (entered, release, acknowledged) = backend.pause_next_mode();
    let mut first = Box::pin(radio.set_mode_and_frequency(Mode::CW, Freq::from_u32_hz(7_050_000)));
    assert!(poll!(first.as_mut()).is_pending());
    tokio::time::timeout(Duration::from_secs(3), entered)
        .await
        .unwrap()
        .unwrap();
    let mut replacement = Box::pin(radio.replace(
        RadioConfig { rig: None },
        ActiveRadioBackend::Configured(RadioBackendKind::Unconfigured),
        || Box::new(UnavailableRadio::new("radio")),
    ));
    assert!(poll!(replacement.as_mut()).is_pending());
    let mut queued = Box::pin(radio.set_mode_and_frequency(Mode::CW, Freq::from_u32_hz(7_050_000)));
    assert!(poll!(queued.as_mut()).is_pending());
    let enqueued = radio.snapshot();
    assert_eq!(
        enqueued.connection,
        crate::radio_manager::ConnectionState::Connected
    );
    assert!(enqueued.config.rig.is_some());
    assert_eq!(enqueued.selected, selected());
    assert!(poll!(first.as_mut()).is_pending());
    release.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(3), acknowledged)
        .await
        .unwrap()
        .unwrap();
    assert!(first.await.is_err());
    replacement.await.unwrap();
    let error = anyhow::Error::new(queued.await.unwrap_err());
    let after = radio.snapshot();
    let evidence = radio_evidence(&error, &enqueued, &after, "{}");
    radio.shutdown().await.unwrap();
    let pre = &evidence["pre_operation"];
    assert_eq!(pre["application_connection_state"], "disconnected");
    assert_eq!(pre["configuration_present"], false);
    assert_eq!(pre["selected_backend"], "unconfigured");
    assert!(pre["model_id"].is_null());
    assert_eq!(pre["backend_object_present"], true);
    assert_eq!(pre["initialization_failed"], true);
    assert_eq!(pre["initialization"]["outcome"], "failed");
    assert_eq!(pre["disconnect"]["origin"], "initialization");
}

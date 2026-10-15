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
    rig::{Mode, UnavailableRadio},
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
    socket
        .send(Message::Text(
            r#"{"version":1,"type":"radio","action":"SetModeAndFreq","mode":"CW","freq":7050}"#
                .into(),
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
    }
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
}

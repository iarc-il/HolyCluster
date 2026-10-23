use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
};

use futures_util::SinkExt;
use sentry::{Client, ClientOptions};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing_subscriber::layer::SubscriberExt;

use crate::{
    hamlib_radio::HamlibRadio,
    hamlib_radio_tests::{FakeRigctld, net_config},
    radio_config::{ActiveRadioBackend, RadioBackendKind, RadioConfig, RadioRigConfig},
    radio_manager::RadioManager,
    tracing_setup::{sentry_event_filter, sentry_options},
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

#[test]
fn hamlib_native_codes_reach_the_session_envelope() {
    let transport = Arc::new(LocalTransport::default());
    let client = Arc::new(Client::from(ClientOptions {
        transport: Some(Arc::new(transport.clone())),
        server_name: Some("fabricated-personal-workstation".into()),
        ..sentry_options(Some("http://public@127.0.0.1:1/1")).unwrap()
    }));
    let hub = Arc::new(sentry::Hub::new(
        Some(client),
        Arc::new(sentry::Scope::default()),
    ));
    let subscriber = tracing_subscriber::Registry::default()
        .with(sentry::integrations::tracing::layer().event_filter(sentry_event_filter));
    // The session tasks use thread-local capture on this single-thread runtime.
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let home = directories::BaseDirs::new()
        .unwrap()
        .home_dir()
        .to_string_lossy()
        .into_owned();
    sentry::Hub::run(hub, || {
        tracing::subscriber::with_default(subscriber, || {
            runtime.block_on(async {
            for code in [-5, -8] {
                let backend = FakeRigctld::start(SocketAddr::from(([127, 0, 0, 1], 0)), 7_100_000, "USB");
                let native = net_config(backend.address());
                let config = RadioConfig { rig: Some(RadioRigConfig {
                    model_id: format!("hamlib:{}", native.model_id),
                    token_values: native.token_values.clone(),
                }) };
                let selected = ActiveRadioBackend::Configured(RadioBackendKind::Hamlib);
                let radio = RadioManager::new(config.clone(), selected.clone()).unwrap();
                radio.replace(config, selected, move || Box::new(HamlibRadio::new(native.clone()))).await.unwrap();
                assert_eq!(radio.status().status, "connected");
                backend.fail_mode(code);
                // No upstream service is needed for local radio commands.
                let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let (server, _) = super::spawn_catserver_with_radio(upstream.local_addr().unwrap(), None, radio.clone()).await;
                let (mut socket, _) = connect_async(format!("ws://{}/ws", server.address)).await.unwrap();
                super::session::event(&mut socket, "status").await;
                let request = serde_json::json!({
                    "version": 1, "type": "radio", "action": "SetModeAndFreq", "mode": "CW", "freq": 7050,
                    "diagnostic": {format!("{home}/fixture-key"): format!("{home}/fixture-value"),
                        "unknown": "unrecognized diagnostic text", "url": "https://fixture.invalid/path?token=fabricated-secret"}
                });
                socket.send(Message::Text(request.to_string().into())).await.unwrap();
                // The response to the following command proves that session error reporting finished.
                socket.send(Message::Text(r#"{"version":1,"type":"radio","action":"GetCapabilities"}"#.into())).await.unwrap();
                super::session::event(&mut socket, "capabilities").await;
                let commands = backend.commands();
                assert!(commands.iter().any(|command| command.starts_with("M CW ")), "{commands:?}");
                assert!(commands.iter().any(|command| command.starts_with("F ")), "{commands:?}");
                socket.close(None).await.unwrap();
                drop(server);
                radio.shutdown().await.unwrap();
            }
        });
        })
    });
    let envelopes = transport.0.lock().unwrap();
    assert_eq!(envelopes.len(), 2);
    for (bytes, code) in envelopes.iter().zip([-5, -8]) {
        let output = std::str::from_utf8(bytes).unwrap();
        assert!(
            !output.contains(&home),
            "home prefix remains in transport output"
        );
        assert!(!output.contains("server_name"));
        assert!(!output.contains("fabricated-personal-workstation"));
        let event: serde_json::Value =
            serde_json::from_str(output.lines().nth(2).unwrap()).unwrap();
        assert_eq!(event["release"], env!("VERSION"));
        assert_eq!(event["environment"], env!("CATSERVER_SENTRY_ENVIRONMENT"));
        assert_eq!(
            event["message"],
            "Failed to process radio WebSocket message"
        );
        let fields = &event["contexts"]["Rust Tracing Fields"];
        assert_eq!(fields["action"], "SetModeAndFreq");
        for field in ["model_id", "device_connected", "error_summary"] {
            assert!(fields.get(field).is_none());
        }
        let evidence: serde_json::Value =
            serde_json::from_str(fields["failure_evidence"].as_str().unwrap()).unwrap();
        let summary = evidence["error_chain"]
            .as_array()
            .unwrap()
            .iter()
            .map(|cause| cause.as_str().unwrap())
            .collect::<Vec<_>>()
            .join("; ");
        assert!(summary.contains("set mode"), "{summary}");
        assert!(
            summary.contains(&format!("Hamlib rig_set_mode failed with code {code}:")),
            "{summary}"
        );
        assert!(!summary.contains(&format!("code {}:", if code == -5 { -8 } else { -5 })));
        assert_eq!(evidence["stage"], "radio_command");
        assert!(
            evidence["error_chain"]
                .as_array()
                .unwrap()
                .iter()
                .any(|cause| cause
                    .as_str()
                    .unwrap()
                    .contains(&format!("rig_set_mode failed with code {code}:")))
        );
        assert_eq!(
            evidence["request"]["diagnostic"]["~/fixture-key"],
            "~/fixture-value"
        );
        assert_eq!(
            evidence["request"]["diagnostic"]["unknown"],
            "unrecognized diagnostic text"
        );
        assert_eq!(
            evidence["request"]["diagnostic"]["url"],
            "https://fixture.invalid/path?token=fabricated-secret"
        );
        assert_eq!(evidence["request"]["freq"], 7050);
        println!("LOCAL HAMLIB ENVELOPE: {output}");
    }
}

use std::{
    io::{self, Write},
    sync::{Arc, Mutex},
};

use futures_util::SinkExt;
use sentry::{Client, ClientOptions, protocol::Event};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing_subscriber::{Layer, layer::SubscriberExt};

#[derive(Clone, Default)]
struct Output(Arc<Mutex<Vec<u8>>>);

impl Write for Output {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[derive(Default)]
struct MemoryTransport(Mutex<Vec<Event<'static>>>);

impl sentry::Transport for MemoryTransport {
    fn send_envelope(&self, envelope: sentry::Envelope) {
        for item in envelope.items() {
            if let sentry::protocol::EnvelopeItem::Event(event) = item {
                self.0.lock().unwrap().push(event.clone());
            }
        }
    }
}

#[test]
fn commands_log_only_actions_at_info_and_one_full_sentry_breadcrumb_each() {
    let output = Output::default();
    let writer = output.clone();
    let transport = Arc::new(MemoryTransport::default());
    let client = Arc::new(Client::from(ClientOptions {
        transport: Some(Arc::new(transport.clone())),
        ..crate::tracing_setup::sentry_options(Some("http://public@127.0.0.1:1/1")).unwrap()
    }));
    let hub = Arc::new(sentry::Hub::new(
        Some(client),
        Arc::new(sentry::Scope::default()),
    ));
    let subscriber = tracing_subscriber::Registry::default()
        .with(
            tracing_subscriber::fmt::layer()
                .without_time()
                .with_ansi(false)
                .with_writer(move || writer.clone())
                .with_filter(tracing_subscriber::filter::LevelFilter::INFO),
        )
        .with(
            sentry::integrations::tracing::layer()
                .event_filter(crate::tracing_setup::sentry_event_filter),
        );
    let commands = [
        (
            r#"{"version":1,"type":"radio","action":"GetCapabilities","probe":"radio-payload-only"}"#,
            "GetCapabilities",
            "capabilities",
        ),
        (
            r#"{"version":1,"type":"rotator","action":"GetRotatorConfiguration","probe":"rotator-payload-only"}"#,
            "GetRotatorConfiguration",
            "rotator_configuration",
        ),
    ];
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    sentry::Hub::run(hub, || {
        tracing::subscriber::with_default(subscriber, || {
            runtime.block_on(async {
                let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let server = super::spawn_catserver(upstream.local_addr().unwrap()).await;
                let (mut socket, _) = connect_async(format!("ws://{}/ws", server.address))
                    .await
                    .unwrap();
                for (command, _, response) in commands {
                    socket.send(Message::Text(command.into())).await.unwrap();
                    super::session::event(&mut socket, response).await;
                }
                tracing::error!("Capture command breadcrumbs");
                socket.close(None).await.unwrap();
            });
        });
    });
    let output = String::from_utf8(output.0.lock().unwrap().clone()).unwrap();
    let lines: Vec<_> = output
        .lines()
        .filter(|line| line.contains("CAT command"))
        .collect();
    assert_eq!(lines.len(), commands.len(), "{output}");
    let events = transport.0.lock().unwrap();
    let event = events
        .iter()
        .find(|event| event.message.as_deref() == Some("Capture command breadcrumbs"))
        .unwrap();
    let breadcrumbs: Vec<_> = event
        .breadcrumbs
        .iter()
        .filter(|breadcrumb| breadcrumb.message.as_deref() == Some("CAT command"))
        .collect();
    assert_eq!(breadcrumbs.len(), commands.len());
    for (command, action, _) in commands {
        assert!(lines.iter().any(|line| line.contains(action)));
        assert!(!output.contains(command), "{output}");
        assert!(!output.contains("payload-only"), "{output}");
        assert!(!lines.iter().any(|line| line.contains("command=")));
        let matches: Vec<_> = breadcrumbs
            .iter()
            .filter(|breadcrumb| breadcrumb.data.get("command") == Some(&command.into()))
            .collect();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].level, sentry::Level::Debug);
        assert_eq!(
            matches[0].category.as_deref(),
            Some("catserver::diagnostic")
        );
        assert_eq!(matches[0].data["action"], action);
    }
}

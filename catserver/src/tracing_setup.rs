use std::{
    borrow::Cow,
    fs::{File, OpenOptions},
    sync::Arc,
    time::Duration,
};

use directories::ProjectDirs;
use sentry::{
    ClientInitGuard, ClientOptions,
    integrations::tracing::EventFilter,
    protocol::{Breadcrumb, Event},
};
use tracing::level_filters::LevelFilter;
use tracing_panic::panic_hook;
use tracing_subscriber::{
    EnvFilter, Layer, Registry, layer::SubscriberExt, util::SubscriberInitExt,
};

const SENTRY_ENVIRONMENT: &str = env!("CATSERVER_SENTRY_ENVIRONMENT");
const SENTRY_DSN: &str = env!("CATSERVER_SENTRY_DSN");

fn open_debug_log() -> Option<File> {
    let project_dirs = ProjectDirs::from("org", "iarc", "holycluster")?;
    let cache_dir = project_dirs.cache_dir();
    std::fs::create_dir_all(cache_dir).ok()?;
    OpenOptions::new()
        .append(true)
        .create(true)
        .open(cache_dir.join("debug.log"))
        .ok()
}

fn log_file_filter() -> EnvFilter {
    let filter = EnvFilter::builder()
        .with_default_directive(LevelFilter::INFO.into())
        .from_env_lossy();
    match "catserver=debug".parse() {
        Ok(directive) => filter.add_directive(directive),
        Err(error) => {
            eprintln!("Failed to add catserver debug log directive: {error}");
            filter
        }
    }
}

fn sentry_event_filter(metadata: &tracing::Metadata<'_>) -> EventFilter {
    if *metadata.level() == tracing::Level::ERROR {
        EventFilter::Event
    } else {
        EventFilter::Ignore
    }
}

pub fn configure() -> Option<ClientInitGuard> {
    std::panic::set_hook(Box::new(panic_hook));
    let console_layer = tracing_subscriber::fmt::layer()
        .compact()
        .with_ansi(!cfg!(windows))
        .with_filter(tracing_subscriber::filter::LevelFilter::from_level(
            tracing::Level::INFO,
        ));
    let sentry_layer = sentry::integrations::tracing::layer().event_filter(sentry_event_filter);
    let result = if let Some(debug_file) = open_debug_log() {
        Registry::default()
            .with(console_layer)
            .with(sentry_layer)
            .with(
                tracing_subscriber::fmt::layer()
                    .compact()
                    .with_writer(debug_file)
                    .with_filter(log_file_filter()),
            )
            .try_init()
    } else {
        Registry::default()
            .with(console_layer)
            .with(sentry_layer)
            .try_init()
    };
    if let Err(error) = result {
        eprintln!("Failed to configure tracing subscriber: {error}");
    }
    configure_sentry(Some(SENTRY_DSN))
}

fn configure_sentry(dsn: Option<&str>) -> Option<ClientInitGuard> {
    sentry_options(dsn).map(sentry::init)
}

fn sentry_options(dsn: Option<&str>) -> Option<ClientOptions> {
    let dsn = dsn.filter(|dsn| !dsn.trim().is_empty())?;
    let dsn = match dsn.parse() {
        Ok(dsn) => dsn,
        Err(error) => {
            tracing::warn!(?error, "Sentry is disabled because SENTRY_DSN is invalid");
            return None;
        }
    };
    Some(ClientOptions {
        dsn: Some(dsn),
        release: Some(Cow::Borrowed(env!("VERSION"))),
        environment: Some(Cow::Borrowed(SENTRY_ENVIRONMENT)),
        attach_stacktrace: true,
        max_breadcrumbs: 0,
        send_default_pii: false,
        before_breadcrumb: Some(Arc::new(scrub_breadcrumb)),
        before_send: Some(Arc::new(scrub_event)),
        shutdown_timeout: Duration::from_millis(500),
        ..Default::default()
    })
}

fn scrub_breadcrumb(_: Breadcrumb) -> Option<Breadcrumb> {
    None
}

fn scrub_event(mut event: Event<'static>) -> Option<Event<'static>> {
    if is_expected_radio_error(&event) {
        return None;
    }
    let operation = event
        .logger
        .clone()
        .unwrap_or_else(|| "catserver".to_owned());
    let error_type = event
        .exception
        .iter()
        .last()
        .map(|exception| exception.ty.clone())
        .filter(|ty| !ty.is_empty())
        .unwrap_or_else(|| "Error".to_owned());
    let tracing_location = event.contexts.remove("Rust Tracing Location");
    let update_failure = event
        .contexts
        .remove("Rust Tracing Fields")
        .and_then(|context| {
            let sentry::protocol::Context::Other(mut fields) = context else {
                return None;
            };
            let stage = fields.remove("error_stage")?;
            if !matches!(
                stage.as_str(),
                Some("stage_update_helper" | "start_update_helper" | "update_request")
            ) {
                return None;
            }
            let mut safe_fields = std::collections::BTreeMap::new();
            safe_fields.insert("stage".to_owned(), stage);
            if let Some(kind) = fields.remove("io_error_kind")
                && matches!(
                    kind.as_str(),
                    Some(
                        "NotFound"
                            | "PermissionDenied"
                            | "AlreadyExists"
                            | "WouldBlock"
                            | "InvalidInput"
                            | "Other"
                            | "NotApplicable"
                    )
                )
            {
                safe_fields.insert("io_error_kind".to_owned(), kind);
            }
            if let Some(code) = fields.remove("os_error_code")
                && code
                    .as_i64()
                    .is_some_and(|value| value > 0 && value <= i32::MAX as i64)
            {
                safe_fields.insert("os_error_code".to_owned(), code);
            }
            Some(sentry::protocol::Context::Other(safe_fields))
        });

    event.user = None;
    event.request = None;
    event.server_name = None;
    event.contexts.clear();
    if let Some(location) = tracing_location {
        event
            .contexts
            .insert("Rust Tracing Location".to_owned(), location);
    }
    if let Some(failure) = update_failure {
        event.contexts.insert("Update Failure".to_owned(), failure);
    }
    event.extra.clear();
    event.tags.clear();
    event.tags.insert("operation".to_owned(), operation.clone());
    event.fingerprint = Cow::Owned(vec![
        Cow::Owned(operation.clone()),
        Cow::Owned(error_type.clone()),
    ]);
    event.message = Some(format!("{error_type} in {operation}"));
    event.logentry = None;
    for exception in &mut event.exception {
        exception.value = None;
    }
    event.release = Some(Cow::Borrowed(env!("VERSION")));
    event.environment = Some(Cow::Borrowed(SENTRY_ENVIRONMENT));
    Some(event)
}

fn is_expected_radio_error(event: &Event<'_>) -> bool {
    let message = event
        .message
        .as_deref()
        .or_else(|| event.logentry.as_ref().map(|entry| entry.message.as_str()));
    message.is_some_and(|message| {
        [
            "Radio configuration is invalid",
            "Rotator initialization failed",
        ]
        .iter()
        .any(|expected| message.starts_with(expected))
    })
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        sync::{Arc, Mutex},
        time::{Duration, Instant},
    };

    use sentry::{
        Client, ClientOptions,
        protocol::{Context, Event, Exception, Request, User},
    };

    use tracing_subscriber::layer::SubscriberExt;

    use super::{
        SENTRY_ENVIRONMENT, configure_sentry, scrub_breadcrumb, scrub_event, sentry_event_filter,
        sentry_options,
    };

    #[test]
    fn skips_sentry_without_a_dsn() {
        assert!(configure_sentry(None).is_none());
        assert!(configure_sentry(Some("")).is_none());
        assert!(configure_sentry(Some("   ")).is_none());
        assert!(configure_sentry(Some("not-a-dsn")).is_none());
    }

    #[test]
    fn scrubs_sensitive_event_data_and_enforces_metadata() {
        let event = sentry::protocol::Event {
            user: Some(User::default()),
            request: Some(Request::default()),
            server_name: Some("workstation".into()),
            release: Some("untrusted".into()),
            environment: Some("untrusted".into()),
            contexts: BTreeMap::from([
                ("radio".into(), Context::Other(BTreeMap::new())),
                (
                    "Rust Tracing Location".into(),
                    Context::Other(BTreeMap::new()),
                ),
            ]),
            extra: BTreeMap::from([("token".into(), "secret".into())]),
            tags: BTreeMap::from([("callsign".into(), "N0CALL".into())]),
            logger: Some("catserver::radio".into()),
            message: Some("private radio failure".into()),
            exception: sentry::protocol::Values {
                values: vec![Exception {
                    ty: "RadioError".into(),
                    value: Some("private exception".into()),
                    ..Default::default()
                }],
            },
            ..Default::default()
        };

        let event = scrub_event(event).unwrap();

        assert!(event.user.is_none());
        assert!(event.request.is_none());
        assert!(event.server_name.is_none());
        assert_eq!(
            event.contexts.keys().collect::<Vec<_>>(),
            vec!["Rust Tracing Location"]
        );
        assert!(event.extra.is_empty());
        assert_eq!(
            event.tags,
            BTreeMap::from([("operation".into(), "catserver::radio".into())])
        );
        assert_eq!(
            event.message.as_deref(),
            Some("RadioError in catserver::radio")
        );
        assert_eq!(
            event.fingerprint.as_ref(),
            ["catserver::radio", "RadioError"]
        );
        assert!(event.logentry.is_none());
        assert!(
            event
                .exception
                .iter()
                .all(|exception| exception.value.is_none())
        );
        assert_eq!(event.release.as_deref(), Some(env!("VERSION")));
        assert_eq!(event.environment.as_deref(), Some(SENTRY_ENVIRONMENT));
    }

    #[test]
    fn preserves_safe_update_failure_codes_without_error_text() {
        let event = Event {
            contexts: BTreeMap::from([(
                "Rust Tracing Fields".into(),
                Context::Other(BTreeMap::from([
                    ("error_stage".into(), "stage_update_helper".into()),
                    ("io_error_kind".into(), "PermissionDenied".into()),
                    ("os_error_code".into(), 32.into()),
                    (
                        "error".into(),
                        "C:/Users/private/update-helper.exe secret".into(),
                    ),
                ])),
            )]),
            ..Default::default()
        };
        let event = scrub_event(event).unwrap();
        let Context::Other(fields) = &event.contexts["Update Failure"] else {
            panic!("missing safe diagnostics")
        };
        assert_eq!(
            fields,
            &BTreeMap::from([
                ("stage".into(), "stage_update_helper".into()),
                ("io_error_kind".into(), "PermissionDenied".into()),
                ("os_error_code".into(), 32.into()),
            ])
        );
        assert!(!serde_json::to_string(&event).unwrap().contains("private"));
        assert!(!serde_json::to_string(&event).unwrap().contains("secret"));
    }

    #[test]
    fn rejects_untrusted_update_failure_values() {
        let event = Event {
            contexts: BTreeMap::from([(
                "Rust Tracing Fields".into(),
                Context::Other(BTreeMap::from([
                    ("error_stage".into(), "stage_update_helper".into()),
                    ("io_error_kind".into(), "private path".into()),
                    ("os_error_code".into(), "secret".into()),
                ])),
            )]),
            ..Default::default()
        };
        let event = scrub_event(event).unwrap();
        let Context::Other(fields) = &event.contexts["Update Failure"] else {
            panic!("missing safe diagnostics")
        };
        assert_eq!(fields.len(), 1);
    }

    #[test]
    fn drops_breadcrumbs() {
        assert!(scrub_breadcrumb(sentry::protocol::Breadcrumb::default()).is_none());
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
    fn valid_dsn_enables_reporting_and_scrubs_msi_failure() {
        let transport = Arc::new(MemoryTransport::default());
        let options = sentry_options(Some("http://public@127.0.0.1:1/1")).unwrap();
        assert_eq!(options.environment.as_deref(), Some(SENTRY_ENVIRONMENT));
        assert!(!options.send_default_pii);
        let client = Arc::new(Client::from(ClientOptions {
            transport: Some(Arc::new(transport.clone())),
            ..options
        }));
        assert!(client.is_enabled());
        let hub = sentry::Hub::new(Some(client), Arc::new(sentry::Scope::default()));
        let subscriber = tracing_subscriber::Registry::default()
            .with(sentry::integrations::tracing::layer().event_filter(sentry_event_filter));
        sentry::Hub::run(Arc::new(hub), || {
            tracing::subscriber::with_default(subscriber, || {
                tracing::info!("not an error");
                tracing::error!("Radio configuration is invalid; private details");
                tracing::error!("Rotator initialization failed; private details");
                let error = anyhow::anyhow!(
                    "MSI installer exited with code 1603; see msi-install.log; MSI rollback is not guaranteed"
                );
                tracing::error!(
                    ?error,
                    artifact_path = "C:/Users/private/update.msi",
                    "Catserver terminated unexpectedly"
                );
            });
        });
        let events = transport.0.lock().unwrap();
        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(event.environment.as_deref(), Some(SENTRY_ENVIRONMENT));
        assert_eq!(event.release.as_deref(), Some(env!("VERSION")));
        assert!(event.user.is_none());
        assert!(event.request.is_none());
        assert!(event.extra.is_empty());
        assert!(!event.contexts.contains_key("Rust Tracing Fields"));
        let serialized = serde_json::to_string(event).unwrap();
        assert!(!serialized.contains("private"));
        assert!(!serialized.contains("1603"));
    }

    #[test]
    fn offline_transport_does_not_block_event_capture() {
        let options = ClientOptions {
            dsn: Some("http://public@127.0.0.1:1/1".parse().unwrap()),
            default_integrations: false,
            shutdown_timeout: Duration::ZERO,
            ..Default::default()
        };
        let transport = Arc::new(sentry::transports::ReqwestHttpTransport::new(&options));
        let client = Client::from(ClientOptions {
            transport: Some(Arc::new(transport)),
            ..options
        });

        let started = Instant::now();
        client.capture_event(Event::default(), None);

        assert!(started.elapsed() < Duration::from_millis(100));
        client.close(Some(Duration::ZERO));
    }
}

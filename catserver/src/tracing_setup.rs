use std::{
    borrow::Cow,
    fs::{File, OpenOptions},
    sync::Arc,
    time::Duration,
};

use directories::ProjectDirs;
use sentry::{ClientInitGuard, ClientOptions, integrations::tracing::EventFilter};
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

pub(crate) fn sentry_event_filter(metadata: &tracing::Metadata<'_>) -> EventFilter {
    if metadata.target() == "catserver::diagnostic" {
        EventFilter::Breadcrumb
    } else if *metadata.level() == tracing::Level::ERROR {
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

pub(crate) fn sentry_options(dsn: Option<&str>) -> Option<ClientOptions> {
    let dsn = dsn.filter(|dsn| !dsn.trim().is_empty())?;
    let dsn = match dsn.parse() {
        Ok(dsn) => dsn,
        Err(error) => {
            tracing::warn!(?error, "Sentry is disabled because SENTRY_DSN is invalid");
            return None;
        }
    };
    let fallback_client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            tracing::warn!(
                ?error,
                "Sentry is disabled because its HTTP client could not be built"
            );
            return None;
        }
    };
    let redactions = Arc::new(crate::diagnostic_redaction::Redactions::current());
    let breadcrumb_redactions = Arc::clone(&redactions);
    Some(ClientOptions {
        dsn: Some(dsn),
        release: Some(Cow::Borrowed(env!("VERSION"))),
        environment: Some(Cow::Borrowed(SENTRY_ENVIRONMENT)),
        attach_stacktrace: true,
        max_breadcrumbs: 20,
        send_default_pii: false,
        before_breadcrumb: Some(Arc::new(move |breadcrumb| {
            breadcrumb_redactions.breadcrumb(breadcrumb)
        })),
        before_send: Some(Arc::new(move |mut event| {
            if let serde_json::Value::Object(context) = crate::diagnostics::context() {
                event.contexts.insert(
                    "catserver_runtime".into(),
                    sentry::protocol::Context::Other(context.into_iter().collect()),
                );
            }
            redactions.event(event)
        })),
        // The SDK also joins its worker on drop; this is not a total exit deadline.
        shutdown_timeout: Duration::from_secs(2),
        transport: Some(Arc::new(move |options: &ClientOptions| {
            let mut builder = reqwest::Client::builder()
                .timeout(Duration::from_secs(2))
                .danger_accept_invalid_certs(options.accept_invalid_certs);
            // Match the SDK's proxy handling after sentry::init applies defaults.
            if let Some(url) = &options.http_proxy
                && let Ok(proxy) = reqwest::Proxy::http(url.as_ref())
            {
                builder = builder.proxy(proxy);
            }
            if let Some(url) = &options.https_proxy
                && let Ok(proxy) = reqwest::Proxy::https(url.as_ref())
            {
                builder = builder.proxy(proxy);
            }
            let client = builder.build().unwrap_or_else(|error| {
                tracing::warn!(
                    ?error,
                    "Sentry HTTP client configuration failed; using default proxy settings"
                );
                fallback_client.clone()
            });
            Arc::new(sentry::transports::ReqwestHttpTransport::with_client(
                options, client,
            )) as Arc<dyn sentry::Transport>
        })),
        ..Default::default()
    })
}

pub(crate) fn websocket_action(message: &str) -> String {
    serde_json::from_str::<serde_json::Value>(message)
        .ok()
        .and_then(|value| {
            value
                .get("action")
                .and_then(|action| action.as_str())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "UnknownAction".to_owned())
}

pub(crate) fn rotator_model_id(rotator: &crate::rotator_manager::RotatorManager) -> String {
    match rotator.snapshot().config {
        crate::rotator_config::RotatorConfig::Hamlib { hamlib } => {
            format!("hamlib:{}", hamlib.model_id)
        }
        crate::rotator_config::RotatorConfig::Unconfigured => String::new(),
    }
}

pub(crate) fn error_summary(error: &anyhow::Error) -> String {
    error
        .chain()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join("; ")
}

type Evidence = std::collections::BTreeMap<String, serde_json::Value>;

fn diagnostic_io_summary(kind: std::io::ErrorKind, code: i32) -> String {
    format!("IO {kind:?} (OS code {code})")
}

fn hresult(message: &str) -> Option<u32> {
    let code = message.strip_prefix("[0x")?.split_once(']')?.0;
    if !(4..=8).contains(&code.len()) || !code.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    u32::from_str_radix(code, 16).ok()
}

pub(crate) fn native_error(error: &(dyn std::error::Error + 'static)) -> serde_json::Value {
    let mut result =
        serde_json::json!({"text": error.to_string(), "hamlib_version": hamlib::version()});
    let mut cause = Some(error);
    while let Some(error) = cause {
        if let Some(native) = error.downcast_ref::<hamlib::HamlibError>() {
            match native {
                hamlib::HamlibError::Call {
                    operation, code, ..
                }
                | hamlib::HamlibError::NullErrorText { operation, code }
                | hamlib::HamlibError::InvalidErrorText { operation, code } => {
                    result["operation"] = (*operation).into();
                    result["code"] = (*code).into();
                }
                _ => {}
            }
        }
        cause = error.source();
    }
    result
}

fn initialization_evidence(fields: &mut Evidence, error: &crate::rig::RadioInitError) {
    fields.insert("initialization".into(), error.to_string().into());
    fields.insert("initialization_native".into(), format!("{error:?}").into());
    fields.insert("hamlib_version".into(), hamlib::version().into());
    if let crate::rig::RadioInitError::Com { context, .. } = error {
        fields.insert("initialization_call".into(), serde_json::json!(context));
    }
    if let crate::rig::RadioInitError::Hamlib {
        details: Some(details),
        ..
    } = error
    {
        fields.insert("initialization_details".into(), details.clone().into());
    }
}

pub(crate) fn failure_evidence(error: &anyhow::Error, stage: &'static str) -> Evidence {
    let mut fields = Evidence::from([
        ("stage".into(), stage.into()),
        (
            "error_chain".into(),
            serde_json::json!(error.chain().map(ToString::to_string).collect::<Vec<_>>()),
        ),
    ]);
    if stage.starts_with("tray_") {
        fields.insert("desktop".into(), crate::desktop::context());
        fields.insert("server_continues".into(), true.into());
        fields.insert(
            "native_errors".into(),
            serde_json::json!(
                error
                    .chain()
                    .map(|cause| format!("{cause:?}"))
                    .collect::<Vec<_>>()
            ),
        );
        if let Some(stage) = error.downcast_ref::<crate::tray_icon::TrayStage>() {
            fields.insert("stage".into(), stage.0.into());
        }
    }
    let mut categories = Vec::new();
    for cause in error.chain() {
        let category = if let Some(io) = cause.downcast_ref::<std::io::Error>() {
            fields.insert(
                "io_summary".into(),
                diagnostic_io_summary(io.kind(), io.raw_os_error().unwrap_or(0)).into(),
            );
            "io"
        } else if let Some(request) = cause.downcast_ref::<reqwest::Error>() {
            if let Some(status) = request.status() {
                fields.insert("http_status".into(), status.as_u16().into());
            }
            if let Some(url) = request.url() {
                fields.insert("destination".into(), url.as_str().into());
            }
            if request.is_timeout() {
                "network_timeout"
            } else if request.is_connect() {
                "network_connect"
            } else if request.is_redirect() {
                "network_redirect"
            } else if request.is_status() {
                "http_status"
            } else if request.is_decode() {
                "network_decode"
            } else if request.is_body() {
                "network_body"
            } else if request.is_builder() {
                "network_builder"
            } else {
                "network_request"
            }
        } else if let Some(http) = cause.downcast_ref::<crate::updater::UpdateHttpFailure>() {
            fields.insert("http".into(), http.evidence.clone());
            "update_http"
        } else if cause.is::<serde_json::Error>() {
            "json"
        } else if let Some(init) = cause.downcast_ref::<crate::rig::RadioInitError>() {
            initialization_evidence(&mut fields, init);
            "radio_initialization"
        } else if let Some(operation) = cause.downcast_ref::<crate::rig::RadioOperationError>() {
            if let Some(context) = &operation.actor_context {
                fields.insert(
                    "pre_operation".into(),
                    serde_json::json!({
                        "application_connection_state": context.application_connection_state,
                        "configuration_present": context.configuration_present,
                        "selected_backend": context.selected_backend,
                        "model_id": context.model_id,
                        "backend_object_present": context.backend_object_present,
                        "initialization_failed": context.initialization_failed,
                        "initialization": context.initialization,
                        "disconnect": context.disconnect,
                        "outage_ms": context.outage_ms,
                        "failed_attempts": context.failed_attempts,
                        "retry_delay_ms": context.retry_delay_ms,
                        "next_retry_ms": context.next_retry_ms,
                        "requested_mode": context.requested_mode,
                        "requested_frequency_hz": context.requested_frequency_hz,
                        "requested_vfo": context.requested_vfo,
                    }),
                );
            }
            if let Some(context) = &operation.backend_context {
                fields.insert("backend_call".into(), serde_json::json!(context));
            }
            let code = match &operation.backend_context {
                Some(context) => context.hresult,
                None => hresult(&operation.message),
            };
            if let Some(code) = code {
                fields.insert("hresult".into(), code.into());
            }
            if let Some(native) = &operation.native_error {
                fields.insert("native_error".into(), native.clone());
            }
            fields.insert("hamlib_version".into(), hamlib::version().into());
            if let Some(details) = &operation.details {
                fields.insert("operation_details".into(), details.clone().into());
            }
            "radio_operation"
        } else if let Some(rotator) = cause.downcast_ref::<crate::rotator::RotatorError>() {
            fields.insert("native_operation".into(), rotator.operation.into());
            fields.insert(
                "actor_context".into(),
                serde_json::json!(rotator.actor_context),
            );
            fields.insert(
                "native_error".into(),
                serde_json::json!(rotator.native_error),
            );
            "rotator_operation"
        } else if let Some(tray) = cause.downcast_ref::<tray_icon::Error>() {
            match tray {
                tray_icon::Error::OsError(io) => {
                    fields.insert(
                        "io_summary".into(),
                        diagnostic_io_summary(io.kind(), io.raw_os_error().unwrap_or(0)).into(),
                    );
                    "tray_os"
                }
                tray_icon::Error::NotMainThread => "tray_not_main_thread",
                #[cfg(any(target_os = "linux", target_os = "macos"))]
                tray_icon::Error::PngEncodingError(_) => "tray_png_encoding",
                _ => "tray_other",
            }
        } else if cause.is::<crate::radio_config::RadioConfigError>() {
            "radio_configuration"
        } else if cause.is::<crate::radio_manager::RadioManagerError>() {
            "radio_manager"
        } else {
            "unclassified"
        };
        categories.push(category);
    }
    fields.insert("cause_categories".into(), serde_json::json!(categories));
    fields
}

pub(crate) fn radio_evidence(
    error: &anyhow::Error,
    before_command: &crate::radio_manager::RadioSnapshot,
    snapshot: &crate::radio_manager::RadioSnapshot,
    message: &str,
) -> Evidence {
    use crate::radio_manager::ConnectionState;
    let mut fields = failure_evidence(error, "radio_command");
    fields.insert("pre_state".into(), radio_state(before_command));
    fields.insert("post_state".into(), radio_state(snapshot));
    fields.insert(
        "connection_state".into(),
        match snapshot.connection {
            ConnectionState::Connected => "connected",
            ConnectionState::Disconnected => "disconnected",
        }
        .into(),
    );
    fields.insert(
        "configuration_present".into(),
        snapshot.config.rig.is_some().into(),
    );
    // Keep history from before execution and connectivity from after execution.
    if let Some(init) = &before_command.last_error {
        initialization_evidence(&mut fields, init);
    }
    if let Some(last) = &before_command.last_operation_error {
        fields.insert("previous_operation".into(), last.to_string().into());
        if let Some(details) = &last.details {
            fields.insert("previous_operation_details".into(), details.clone().into());
        }
    }
    if let Ok(request) = serde_json::from_str::<serde_json::Value>(message) {
        if let Some(mode) = request.get("mode") {
            fields.insert("requested_mode".into(), mode.clone());
        }
        fields.insert("request".into(), request);
    } else {
        fields.insert("request".into(), message.into());
    }
    fields
}

pub(crate) fn rotator_state(
    snapshot: &crate::rotator_manager::RotatorSnapshot,
) -> serde_json::Value {
    serde_json::json!({
        "config": snapshot.config, "selected_backend": snapshot.selected.to_string(),
        "connection": format!("{:?}", snapshot.connection), "last_status": snapshot.last_status,
        "last_error": snapshot.last_error, "target_azimuth": snapshot.target_azimuth,
    })
}

pub(crate) fn rotator_evidence(
    error: &anyhow::Error,
    before: &crate::rotator_manager::RotatorSnapshot,
    after: &crate::rotator_manager::RotatorSnapshot,
    message: &str,
) -> Evidence {
    let mut fields = failure_evidence(error, "rotator_command");
    fields.insert("pre_state".into(), rotator_state(before));
    fields.insert("post_state".into(), rotator_state(after));
    fields.insert(
        "request".into(),
        serde_json::from_str(message).unwrap_or_else(|_| message.into()),
    );
    fields
}

pub(crate) fn radio_state(snapshot: &crate::radio_manager::RadioSnapshot) -> serde_json::Value {
    serde_json::json!({
        "config": snapshot.config, "selected_backend": format!("{:?}", snapshot.selected),
        "connection": format!("{:?}", snapshot.connection), "last_status": snapshot.last_status,
        "last_initialization_error": snapshot.last_error.as_ref().map(|e| format!("{e:?}")),
        "last_operation_error": snapshot.last_operation_error.as_ref().map(|e| format!("{e:?}")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sentry::{Client, ClientOptions, protocol::Event};
    use std::{
        sync::{Arc, Mutex},
        time::{Duration, Instant},
    };
    use tracing_subscriber::layer::SubscriberExt;

    #[test]
    fn skips_sentry_without_a_dsn() {
        assert!(configure_sentry(None).is_none());
        assert!(configure_sentry(Some("")).is_none());
        assert!(configure_sentry(Some("   ")).is_none());
        assert!(configure_sentry(Some("not-a-dsn")).is_none());
    }

    #[test]
    fn preserves_unknown_actions_and_complete_error_chains() {
        assert_eq!(
            websocket_action(r#"{"action":"BrandNewAction"}"#),
            "BrandNewAction"
        );
        assert_eq!(websocket_action("invalid json"), "UnknownAction");
        let error = anyhow::anyhow!("previously unknown library error: device=/dev/ttyUSB0")
            .context("operation failed with code 1603");
        assert_eq!(
            error_summary(&error),
            "operation failed with code 1603; previously unknown library error: device=/dev/ttyUSB0"
        );
        let evidence = failure_evidence(&error, "new_stage");
        assert_eq!(evidence["stage"], "new_stage");
        assert_eq!(
            evidence["error_chain"],
            serde_json::json!([
                "operation failed with code 1603",
                "previously unknown library error: device=/dev/ttyUSB0"
            ])
        );
    }

    #[test]
    fn retains_radio_history_current_connectivity_and_unrecognized_request_values() {
        use crate::{
            radio_config::{ActiveRadioBackend, RadioBackendKind, RadioConfig},
            radio_manager::{ConnectionState, RadioSnapshot},
            rig::{RadioInitError, RadioOperationError, Status},
        };
        let before = RadioSnapshot {
            selected: ActiveRadioBackend::Configured(RadioBackendKind::Hamlib),
            connection: ConnectionState::Connected,
            last_error: Some(RadioInitError::Hamlib {
                rig: 1,
                error: "backend unavailable at 192.168.1.10:4532".into(),
                details: Some("full initialization details".into()),
            }),
            last_operation_error: Some(RadioOperationError::new(
                1,
                "select VFO",
                "unknown previous operation failure",
            )),
            config: RadioConfig { rig: None },
            last_status: Status::disconnected(1),
        };
        let after = RadioSnapshot {
            connection: ConnectionState::Disconnected,
            last_error: None,
            last_operation_error: None,
            ..before.clone()
        };
        let error = anyhow::Error::new(RadioOperationError::new(
            1,
            "set mode",
            "[0x80070057] complete COM error message",
        ));
        let request = serde_json::json!({"action":"SetModeAndFreq","mode":"NewMode","freq":14074,"new-field":"keep me"});
        let fields = radio_evidence(&error, &before, &after, &request.to_string());
        assert_eq!(fields["connection_state"], "disconnected");
        assert_eq!(fields["configuration_present"], false);
        assert!(
            fields["initialization"]
                .as_str()
                .unwrap()
                .contains("192.168.1.10:4532")
        );
        assert_eq!(
            fields["initialization_details"],
            "full initialization details"
        );
        assert!(
            fields["previous_operation"]
                .as_str()
                .unwrap()
                .contains("unknown previous operation failure")
        );
        assert_eq!(fields["requested_mode"], "NewMode");
        assert_eq!(fields["request"], request);
        assert_eq!(fields["pre_state"]["last_status"]["freq"], 0);
        assert_eq!(
            fields["post_state"]["config"],
            serde_json::json!({"rig": null})
        );
        assert_eq!(fields["pre_state"]["connection"], "Connected");
        assert_eq!(fields["hresult"], 0x80070057u32);
        let first_failure = radio_evidence(&error, &after, &after, "{}");
        assert!(!first_failure.contains_key("initialization"));
        assert!(!first_failure.contains_key("previous_operation"));
        assert!(hresult("[0xsecret] invalid code").is_none());
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
    fn real_sentry_pipeline_keeps_errors_context_and_breadcrumbs() {
        let transport = Arc::new(MemoryTransport::default());
        let client = Arc::new(Client::from(ClientOptions {
            transport: Some(Arc::new(transport.clone())),
            server_name: Some("personal-workstation".into()),
            ..sentry_options(Some("http://public@127.0.0.1:1/1")).unwrap()
        }));
        let hub = sentry::Hub::new(Some(client), Arc::new(sentry::Scope::default()));
        let subscriber = tracing_subscriber::Registry::default()
            .with(sentry::integrations::tracing::layer().event_filter(sentry_event_filter));
        let home = directories::BaseDirs::new()
            .unwrap()
            .home_dir()
            .to_string_lossy()
            .into_owned();
        sentry::Hub::run(Arc::new(hub), || {
            // Client::from does not install the default context integration.
            // Supply an OS context explicitly so this test verifies retention.
            sentry::configure_scope(|scope| {
                scope.set_context(
                    "os",
                    sentry::protocol::Context::Os(Box::new(sentry::protocol::OsContext {
                        name: Some("Unlisted OS".into()),
                        version: Some("rolling-beta".into()),
                        ..Default::default()
                    })),
                );
            });
            tracing::subscriber::with_default(subscriber, || {
                tracing::info!(target: "catserver::diagnostic", action = "NewAction", extra_field = "retained", "CAT command");
                tracing::error!("Radio configuration is invalid; retain diagnostic details");
                tracing::error!("Rotator initialization failed; retain diagnostic details");
                let error =
                    anyhow::anyhow!("MSI installer exited with code 1603; see msi-install.log");
                tracing::error!(?error, artifact_path = %format!("{home}/update.msi"), new_field = "unknown diagnostic value", "Catserver terminated unexpectedly");
                let error = anyhow::Error::new(tray_icon::Error::OsError(
                    std::io::Error::from_raw_os_error(5),
                ));
                tracing::error!(failure_evidence = %serde_json::json!(failure_evidence(&error, "tray_native_build")), "Tray diagnostic regression");
            });
        });
        let events = transport.0.lock().unwrap();
        assert_eq!(events.len(), 4);
        let tray = serde_json::to_value(&events[3]).unwrap();
        let tray: serde_json::Value = serde_json::from_str(
            tray["contexts"]["Rust Tracing Fields"]["failure_evidence"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(tray["server_continues"], true);
        assert!(tray["desktop"].get("DISPLAY").is_some());
        assert!(tray["io_summary"].as_str().unwrap().contains("5"));
        assert!(
            events[0]
                .message
                .as_ref()
                .unwrap()
                .contains("Radio configuration is invalid")
        );
        assert!(
            events[1]
                .message
                .as_ref()
                .unwrap()
                .contains("Rotator initialization failed")
        );
        let event = &events[2];
        assert_eq!(
            event.message.as_deref(),
            Some("Catserver terminated unexpectedly")
        );
        assert_eq!(event.environment.as_deref(), Some(SENTRY_ENVIRONMENT));
        assert_eq!(event.release.as_deref(), Some(env!("VERSION")));
        assert!(event.server_name.is_none());
        assert!(event.contexts.contains_key("os"));
        assert!(event.contexts.contains_key("catserver_runtime"));
        let serialized = serde_json::to_string(event).unwrap();
        assert!(serialized.contains("1603"));
        assert!(serialized.contains("unknown diagnostic value"));
        assert!(serialized.contains("~/update.msi"));
        assert!(!serialized.contains(&home));
        assert_eq!(event.breadcrumbs.len(), 1);
        assert_eq!(event.breadcrumbs[0].data["action"], "NewAction");
        assert_eq!(event.breadcrumbs[0].data["extra_field"], "retained");
    }

    #[test]
    fn stalled_http_request_times_out_without_a_response() {
        use std::{io::Read, net::TcpListener, sync::mpsc, thread};

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (received_tx, received_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut byte = [0];
            stream.read_exact(&mut byte).unwrap();
            received_tx.send(()).unwrap();
            // Keep the connection open without returning any HTTP response.
            let _ = release_rx.recv_timeout(Duration::from_secs(10));
        });
        let options = sentry_options(Some(&format!("http://public@{address}/1"))).unwrap();
        assert_eq!(options.shutdown_timeout, Duration::from_secs(2));
        let client = Client::from(options);
        let started = Instant::now();
        client.capture_event(Event::default(), None);
        let received = received_rx.recv_timeout(Duration::from_secs(5));
        let drained = client.flush(Some(Duration::from_secs(5)));
        let elapsed = started.elapsed();
        // Release the server only after the transport has finished the request.
        let _ = release_tx.send(());
        server.join().unwrap();
        assert!(received.is_ok(), "local server did not receive the request");
        assert!(
            drained,
            "stalled request did not finish within the flush budget"
        );
        assert!(elapsed >= Duration::from_secs(1));
        assert!(elapsed < Duration::from_secs(5));
    }

    #[test]
    fn offline_transport_does_not_block_event_capture() {
        let client = Client::from(ClientOptions {
            shutdown_timeout: Duration::ZERO,
            ..sentry_options(Some("http://public@127.0.0.1:1/1")).unwrap()
        });

        let started = Instant::now();
        client.capture_event(Event::default(), None);

        assert!(started.elapsed() < Duration::from_millis(100));
        client.close(Some(Duration::ZERO));
    }
}

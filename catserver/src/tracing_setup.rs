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

fn sentry_options(dsn: Option<&str>) -> Option<ClientOptions> {
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
    Some(ClientOptions {
        dsn: Some(dsn),
        release: Some(Cow::Borrowed(env!("VERSION"))),
        environment: Some(Cow::Borrowed(SENTRY_ENVIRONMENT)),
        attach_stacktrace: true,
        max_breadcrumbs: 20,
        send_default_pii: false,
        before_breadcrumb: Some(Arc::new(scrub_breadcrumb)),
        before_send: Some(Arc::new(scrub_event)),
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

pub(crate) fn safe_action(action: &str) -> &'static str {
    match action {
        "SetModeAndFreq" => "SetModeAndFreq",
        "HighlightSpot" => "HighlightSpot",
        "GetCapabilities" => "GetCapabilities",
        "ListRadioModels" => "ListRadioModels",
        "ListSerialPorts" => "ListSerialPorts",
        "DescribeRadioModel" => "DescribeRadioModel",
        "GetRadioConfiguration" => "GetRadioConfiguration",
        "SetRadioConfiguration" => "SetRadioConfiguration",
        "TestRadioConnection" => "TestRadioConnection",
        "RetryRadio" => "RetryRadio",
        "SetAzimuth" => "SetAzimuth",
        "ListRotatorModels" => "ListRotatorModels",
        "DescribeRotatorModel" => "DescribeRotatorModel",
        "GetRotatorConfiguration" => "GetRotatorConfiguration",
        "SetRotatorConfiguration" => "SetRotatorConfiguration",
        "TestRotatorConnection" => "TestRotatorConnection",
        "RetryRotator" => "RetryRotator",
        _ => "UnknownAction",
    }
}

pub(crate) fn websocket_action(message: &str) -> &'static str {
    serde_json::from_str::<serde_json::Value>(message)
        .ok()
        .and_then(|value| {
            value
                .get("action")
                .and_then(|action| action.as_str())
                .map(safe_action)
        })
        .unwrap_or("UnknownAction")
}

// Reconstruct known error templates rather than sending arbitrary library text.
fn safe_error_text(message: &str) -> String {
    if message.len() > 1024 {
        return "Error details redacted".to_owned();
    }
    if let Some(rest) = message.strip_prefix("rotator ")
        && let Some((operation, message)) = rest.split_once(" failed: ")
        && [
            "set azimuth",
            "read status",
            "open",
            "initialize",
            "configure",
        ]
        .contains(&operation)
    {
        return format!(
            "Rotator operation {operation}: {}",
            safe_error_text(message)
        );
    }
    if let Some(rest) = message.strip_prefix("Rotator operation ")
        && let Some((operation, message)) = rest.split_once(": ")
        && [
            "set azimuth",
            "read status",
            "open",
            "initialize",
            "configure",
        ]
        .contains(&operation)
    {
        return format!(
            "Rotator operation {operation}: {}",
            safe_error_text(message)
        );
    }
    if let Some(rest) = message.strip_prefix("Radio operation ")
        && let Some((operation, message)) = rest.split_once(": ")
        && [
            "set mode",
            "set frequency",
            "read frequency",
            "read mode",
            "read status",
            "validate frequency",
            "select VFO",
        ]
        .contains(&operation)
    {
        return format!("Radio operation {operation}: {}", safe_error_text(message));
    }
    for text in [
        "radio unavailable",
        "not initialized",
        "frequency must be finite and non-negative",
        "invalid rotator position",
        "radio worker stopped",
        "rotator worker stopped",
        "rotator azimuth must be finite",
    ] {
        if message == text {
            return text.to_owned();
        }
    }
    if message.starts_with("Unknown mode:") {
        return "Unsupported radio mode".to_owned();
    }
    if message == "Unsupported radio mode" || message == "Error details redacted" {
        return message.to_owned();
    }
    if let Some(rest) = message.strip_prefix("Hamlib ")
        && let Some((operation, rest)) = rest.split_once(" failed with code ")
        && [
            "rig_set_mode",
            "rig_set_freq",
            "rig_get_mode",
            "rig_get_freq",
            "rig_get_vfo",
            "rig_set_vfo",
            "rig_open",
            "rot_set_position",
            "rot_get_position",
            "rot_open",
        ]
        .contains(&operation)
        && let Ok(code) = rest.split(':').next().unwrap_or("").parse::<i32>()
    {
        return format!("Hamlib {operation} failed with code {code}");
    }
    "Error details redacted".to_owned()
}

fn canonical_model_id(model: &str) -> Option<String> {
    if model.len() > 64 {
        return None;
    }
    use crate::radio_config::{OmniRigSlot, ResolvedRadioModel, resolve_model_id};
    match resolve_model_id(model).ok()? {
        ResolvedRadioModel::Hamlib(id) => Some(format!("hamlib:{id}")),
        ResolvedRadioModel::Omnirig(OmniRigSlot::Rig1) => Some("omnirig:1".to_owned()),
        ResolvedRadioModel::Omnirig(OmniRigSlot::Rig2) => Some("omnirig:2".to_owned()),
    }
}

pub(crate) fn rotator_model_id(rotator: &crate::rotator_manager::RotatorManager) -> String {
    match rotator.snapshot().config {
        crate::rotator_config::RotatorConfig::Hamlib { hamlib } => {
            format!("hamlib:{}", hamlib.model_id)
        }
        crate::rotator_config::RotatorConfig::Unconfigured => String::new(),
    }
}

fn safe_os(context: Option<sentry::protocol::Context>) -> Option<sentry::protocol::Context> {
    let sentry::protocol::Context::Os(os) = context? else {
        return None;
    };
    let name = os.name.filter(|name| {
        [
            "Windows",
            "Linux",
            "macOS",
            "Mac OS X",
            "Ubuntu",
            "Debian",
            "Fedora",
            "Arch Linux",
        ]
        .contains(&name.as_str())
    })?;
    let version = os.version.filter(|version| {
        version.len() <= 32
            && !version.is_empty()
            && version
                .bytes()
                .all(|byte| byte.is_ascii_digit() || byte == b'.')
    });
    Some(sentry::protocol::Context::Os(Box::new(
        sentry::protocol::OsContext {
            name: Some(name),
            version,
            ..Default::default()
        },
    )))
}

pub(crate) fn error_summary(error: &anyhow::Error) -> String {
    error
        .chain()
        .take(8)
        .filter_map(|cause| {
            if (cause.is::<crate::radio_manager::RadioManagerError>()
                || cause.is::<crate::rotator_manager::RotatorManagerError>())
                && cause.source().is_some()
            {
                return None;
            }
            if let Some(io) = cause.downcast_ref::<std::io::Error>() {
                // ErrorKind and OS codes contain no user-supplied text.
                return Some(format!(
                    "IO {:?} (OS code {})",
                    io.kind(),
                    io.raw_os_error().unwrap_or(0)
                ));
            }
            if let Some(radio) = cause.downcast_ref::<crate::rig::RadioOperationError>() {
                return Some(safe_error_text(&format!(
                    "Radio operation {}: {}",
                    radio.operation, radio.message
                )));
            }
            Some(safe_error_text(&cause.to_string()))
        })
        .collect::<Vec<_>>()
        .join("; ")
}

fn safe_summary(summary: &str) -> String {
    summary
        .split("; ")
        .take(8)
        .map(|text| {
            if let Some(rest) = text.strip_prefix("IO ")
                && let Some((kind, code)) = rest.split_once(" (OS code ")
                && [
                    "NotFound",
                    "PermissionDenied",
                    "ConnectionRefused",
                    "ConnectionReset",
                    "ConnectionAborted",
                    "NotConnected",
                    "AddrInUse",
                    "AddrNotAvailable",
                    "BrokenPipe",
                    "AlreadyExists",
                    "WouldBlock",
                    "InvalidInput",
                    "InvalidData",
                    "TimedOut",
                    "WriteZero",
                    "Interrupted",
                    "UnexpectedEof",
                    "Unsupported",
                    "Other",
                ]
                .contains(&kind)
                && let Some(code) = code
                    .strip_suffix(')')
                    .and_then(|code| code.parse::<i32>().ok())
            {
                return format!("IO {kind} (OS code {code})");
            }
            safe_error_text(text)
        })
        .collect::<Vec<_>>()
        .join("; ")
}

fn scrub_breadcrumb(mut breadcrumb: Breadcrumb) -> Option<Breadcrumb> {
    let action = safe_action(breadcrumb.data.get("action")?.as_str()?);
    if action == "UnknownAction" {
        return None;
    }
    breadcrumb = Breadcrumb {
        timestamp: breadcrumb.timestamp,
        ..Default::default()
    };
    breadcrumb.category = Some("cat.command".to_owned());
    breadcrumb.message = Some(action.to_owned());
    Some(breadcrumb)
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
    let os = safe_os(event.contexts.remove("os"));
    let diagnostics = event
        .contexts
        .get("Rust Tracing Fields")
        .and_then(|context| {
            let sentry::protocol::Context::Other(fields) = context else {
                return None;
            };
            let action = safe_action(fields.get("action")?.as_str()?);
            let summary = safe_summary(fields.get("error_summary")?.as_str()?);
            let connected = fields
                .get("device_connected")
                .and_then(|value| value.as_bool());
            let model = fields
                .get("model_id")
                .and_then(|value| value.as_str())
                .and_then(canonical_model_id);
            Some((action, summary, connected, model))
        });
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
    if let Some(os) = os {
        event.contexts.insert("os".to_owned(), os);
    }
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
    if let Some((action, summary, connected, model)) = diagnostics {
        event.tags.insert("action".to_owned(), action.to_owned());
        event.message = Some(format!("{action}: {summary}"));
        let mut fields = std::collections::BTreeMap::from([
            ("action".to_owned(), action.into()),
            ("error_chain".to_owned(), summary.clone().into()),
        ]);
        if let Some(connected) = connected {
            fields.insert("device_connected".to_owned(), connected.into());
        }
        if let Some(model) = model {
            fields.insert("model_id".to_owned(), model.into());
        }
        event.contexts.insert(
            "CAT Failure".to_owned(),
            sentry::protocol::Context::Other(fields),
        );
        event.fingerprint = Cow::Owned(vec![
            Cow::Owned(operation),
            Cow::Owned(action.to_owned()),
            Cow::Owned(summary),
        ]);
    }
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
    fn retains_safe_cat_diagnostics_and_rejects_sensitive_values() {
        let error = anyhow::Error::new(crate::rig::RadioOperationError::new(
            1,
            "set mode",
            "Hamlib rig_set_mode failed with code -8: /dev/private token=secret K1ABC",
        ));
        let summary = super::error_summary(&error);
        assert_eq!(
            summary,
            "Radio operation set mode: Hamlib rig_set_mode failed with code -8"
        );
        let event = Event {
            logger: Some("catserver::server::session".into()),
            contexts: BTreeMap::from([(
                "Rust Tracing Fields".into(),
                Context::Other(BTreeMap::from([
                    ("action".into(), "SetModeAndFreq".into()),
                    ("error_summary".into(), summary.into()),
                    ("device_connected".into(), true.into()),
                    ("model_id".into(), "hamlib:3073".into()),
                    ("error".into(), "secret K1ABC".into()),
                ])),
            )]),
            ..Default::default()
        };
        let event = scrub_event(event).unwrap();
        assert_eq!(event.tags["action"], "SetModeAndFreq");
        assert_eq!(
            event.message.as_deref(),
            Some(
                "SetModeAndFreq: Radio operation set mode: Hamlib rig_set_mode failed with code -8"
            )
        );
        let Context::Other(fields) = &event.contexts["CAT Failure"] else {
            panic!("missing diagnostics")
        };
        assert_eq!(fields["model_id"], "hamlib:3073");
        assert_eq!(fields["device_connected"], true);
        let serialized = serde_json::to_string(&event).unwrap();
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains("K1ABC"));
        assert!(!serialized.contains("private"));
        assert_eq!(
            super::safe_summary("IO PermissionDenied (OS code 5)"),
            "IO PermissionDenied (OS code 5)"
        );
        assert_eq!(
            super::safe_summary("IO secret (OS code 5)"),
            "Error details redacted"
        );
        assert_eq!(
            super::safe_summary("Hamlib secret failed with code -8: token"),
            "Error details redacted"
        );
        assert_eq!(super::safe_action("K1ABC"), "UnknownAction");
        assert_eq!(
            super::websocket_action(r#"{"action":"SetModeAndFreq","token":"secret"}"#),
            "SetModeAndFreq"
        );
    }

    #[test]
    fn bounds_model_ids_and_preserves_only_safe_os_metadata() {
        assert_eq!(
            super::canonical_model_id("hamlib:0003073"),
            Some("hamlib:3073".into())
        );
        assert!(super::canonical_model_id(&format!("hamlib:{}1", "0".repeat(100))).is_none());
        assert!(super::canonical_model_id("secret").is_none());
        let os = sentry::protocol::OsContext {
            name: Some("Windows".into()),
            version: Some("10.0".into()),
            build: Some("private".into()),
            kernel_version: Some("secret".into()),
            other: BTreeMap::from([("token".into(), "secret".into())]),
            ..Default::default()
        };
        let event = scrub_event(Event {
            contexts: BTreeMap::from([("os".into(), Context::Os(Box::new(os)))]),
            ..Default::default()
        })
        .unwrap();
        let Context::Os(os) = &event.contexts["os"] else {
            panic!("missing OS")
        };
        assert_eq!(os.name.as_deref(), Some("Windows"));
        assert_eq!(os.version.as_deref(), Some("10.0"));
        assert!(!serde_json::to_string(&event).unwrap().contains("secret"));
        assert!(!serde_json::to_string(&event).unwrap().contains("private"));
        let error = anyhow::Error::new(crate::rotator_manager::RotatorManagerError::Operation(
            crate::rotator::RotatorError::new(
                "set azimuth",
                "Hamlib rot_set_position failed with code -6: private",
            ),
        ));
        assert_eq!(
            super::error_summary(&error),
            "Rotator operation set azimuth: Hamlib rot_set_position failed with code -6"
        );
    }

    #[test]
    fn records_safe_command_breadcrumbs_and_preserves_tracing_diagnostics() {
        let transport = Arc::new(MemoryTransport::default());
        let client = Arc::new(Client::from(ClientOptions {
            transport: Some(Arc::new(transport.clone())),
            ..sentry_options(Some("http://public@127.0.0.1:1/1")).unwrap()
        }));
        let hub = sentry::Hub::new(Some(client), Arc::new(sentry::Scope::default()));
        let subscriber = tracing_subscriber::Registry::default()
            .with(sentry::integrations::tracing::layer().event_filter(sentry_event_filter));
        sentry::Hub::run(Arc::new(hub), || {
            tracing::subscriber::with_default(subscriber, || {
                tracing::info!(target: "catserver::diagnostic", action = "SetModeAndFreq", token = "secret", "CAT command");
                let error = anyhow::Error::new(crate::radio_manager::RadioManagerError::Command(
                    crate::rig::RadioOperationError::new(
                        1,
                        "set mode",
                        "Hamlib rig_set_mode failed with code -8: /dev/private secret K1ABC",
                    ),
                ));
                tracing::error!(
                    action = "SetModeAndFreq",
                    error_summary = %super::error_summary(&error),
                    device_connected = false,
                    model_id = "hamlib:3073",
                    error = "secret",
                    "Failed to process radio WebSocket message"
                );
            });
        });
        let events = transport.0.lock().unwrap();
        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(
            event.message.as_deref(),
            Some(
                "SetModeAndFreq: Radio operation set mode: Hamlib rig_set_mode failed with code -8"
            )
        );
        assert_eq!(event.breadcrumbs.len(), 1);
        assert_eq!(
            event.breadcrumbs[0].message.as_deref(),
            Some("SetModeAndFreq")
        );
        assert!(!serde_json::to_string(event).unwrap().contains("secret"));
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

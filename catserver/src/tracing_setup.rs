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

const SENTRY_ENVIRONMENT: &str = if cfg!(debug_assertions) {
    "development"
} else {
    "production"
};

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

pub fn configure() -> Option<ClientInitGuard> {
    std::panic::set_hook(Box::new(panic_hook));
    let console_layer = tracing_subscriber::fmt::layer()
        .compact()
        .with_ansi(!cfg!(windows))
        .with_filter(tracing_subscriber::filter::LevelFilter::from_level(
            tracing::Level::INFO,
        ));
    let sentry_layer = sentry::integrations::tracing::layer().event_filter(|metadata| {
        if *metadata.level() == tracing::Level::ERROR {
            EventFilter::Event
        } else {
            EventFilter::Ignore
        }
    });
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
    configure_sentry(std::env::var("SENTRY_DSN").ok().as_deref())
}

fn configure_sentry(dsn: Option<&str>) -> Option<ClientInitGuard> {
    let dsn = dsn.filter(|dsn| !dsn.trim().is_empty())?;
    let dsn = match dsn.parse() {
        Ok(dsn) => dsn,
        Err(error) => {
            tracing::warn!(?error, "Sentry is disabled because SENTRY_DSN is invalid");
            return None;
        }
    };
    Some(sentry::init(ClientOptions {
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
    }))
}

fn scrub_breadcrumb(_: Breadcrumb) -> Option<Breadcrumb> {
    None
}

fn scrub_event(mut event: Event<'static>) -> Option<Event<'static>> {
    event.user = None;
    event.request = None;
    event.server_name = None;
    event.contexts.clear();
    event.extra.clear();
    event.tags.clear();
    event.release = Some(Cow::Borrowed(env!("VERSION")));
    event.environment = Some(Cow::Borrowed(SENTRY_ENVIRONMENT));
    Some(event)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use sentry::protocol::{Context, Request, User};

    use super::{SENTRY_ENVIRONMENT, configure_sentry, scrub_breadcrumb, scrub_event};

    #[test]
    fn skips_sentry_without_a_dsn() {
        assert!(configure_sentry(None).is_none());
        assert!(configure_sentry(Some("")).is_none());
        assert!(configure_sentry(Some("not-a-dsn")).is_none());
    }

    #[test]
    fn scrubs_sensitive_event_data_and_enforces_metadata() {
        let mut event = sentry::protocol::Event::default();
        event.user = Some(User::default());
        event.request = Some(Request::default());
        event.server_name = Some("workstation".into());
        event
            .contexts
            .insert("radio".into(), Context::Other(BTreeMap::new()));
        event.extra.insert("token".into(), "secret".into());
        event.tags.insert("callsign".into(), "N0CALL".into());
        event.release = Some("untrusted".into());
        event.environment = Some("untrusted".into());

        let event = scrub_event(event).unwrap();

        assert!(event.user.is_none());
        assert!(event.request.is_none());
        assert!(event.server_name.is_none());
        assert!(event.contexts.is_empty());
        assert!(event.extra.is_empty());
        assert!(event.tags.is_empty());
        assert_eq!(event.release.as_deref(), Some(env!("VERSION")));
        assert_eq!(event.environment.as_deref(), Some(SENTRY_ENVIRONMENT));
    }

    #[test]
    fn drops_breadcrumbs() {
        assert!(scrub_breadcrumb(sentry::protocol::Breadcrumb::default()).is_none());
    }
}

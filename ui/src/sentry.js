import * as Sentry from "@sentry/react";

const default_options = {
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
    release: import.meta.env.VITE_SENTRY_RELEASE,
};

export function sanitizeSentryEvent(event) {
    const {
        breadcrumbs: _breadcrumbs,
        contexts: _contexts,
        extra: _extra,
        request: _request,
        user: _user,
        ...sanitized_event
    } = event;

    if (event.exception?.values) {
        sanitized_event.exception = {
            ...event.exception,
            values: event.exception.values.map(value => ({
                ...value,
                value: "Application error",
            })),
        };
    }

    return sanitized_event;
}

export function initializeSentry(options = {}) {
    const settings = { ...default_options, ...options };

    if (!settings.dsn) {
        return false;
    }

    Sentry.init({
        dsn: settings.dsn,
        environment: settings.environment,
        release: settings.release,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        replaysSessionSampleRate: 0,
        beforeSend: sanitizeSentryEvent,
    });

    return true;
}

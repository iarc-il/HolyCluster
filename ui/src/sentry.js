import * as Sentry from "@sentry/react";

const default_options = {
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
    release: import.meta.env.VITE_SENTRY_RELEASE,
};

const sanitized_message = "Application error";

function sanitizeSourceUrl(url) {
    if (typeof url !== "string") {
        return undefined;
    }

    try {
        return new URL(url).pathname;
    } catch {
        return url.split(/[?#]/)[0];
    }
}

function sanitizeExtra(value) {
    if (Array.isArray(value)) {
        return value.map(sanitizeExtra);
    }

    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, nested_value]) => [key, sanitizeExtra(nested_value)]),
        );
    }

    return "[redacted]";
}

function sanitizeException(exception) {
    if (!exception?.values) {
        return exception;
    }

    return {
        ...exception,
        values: exception.values.map(value => ({
            type: value.type,
            value: sanitized_message,
            stacktrace: value.stacktrace && {
                frames: value.stacktrace.frames?.map(frame => ({
                    colno: frame.colno,
                    filename: sanitizeSourceUrl(frame.filename),
                    lineno: frame.lineno,
                })),
            },
        })),
    };
}

export function sanitizeSentryEvent(event) {
    const {
        breadcrumbs: _breadcrumbs,
        contexts: _contexts,
        request: _request,
        tags: _tags,
        user: _user,
        ...sanitized_event
    } = event;

    if (event.extra) {
        sanitized_event.extra = sanitizeExtra(event.extra);
    }

    sanitized_event.exception = sanitizeException(event.exception);
    sanitized_event.logentry = event.logentry && { message: sanitized_message };
    sanitized_event.message = event.message && sanitized_message;

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
        autoSessionTracking: false,
        tracesSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        replaysSessionSampleRate: 0,
        beforeSend: sanitizeSentryEvent,
    });

    return true;
}

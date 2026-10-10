import * as Sentry from "@sentry/react";

const default_options = {
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
    release: import.meta.env.VITE_SENTRY_RELEASE,
};

const sanitized_message = "Application error (message redacted)";

const diagnostic_actions = new Set([
    "tour_started",
    "tour_stopped",
    "profile_switched",
    "SetModeAndFreq",
    "HighlightSpot",
    "GetCapabilities",
    "ListRadioModels",
    "ListSerialPorts",
    "DescribeRadioModel",
    "GetRadioConfiguration",
    "SetRadioConfiguration",
    "TestRadioConnection",
    "RetryRadio",
    "SetAzimuth",
    "ListRotatorModels",
    "DescribeRotatorModel",
    "GetRotatorConfiguration",
    "SetRotatorConfiguration",
    "TestRotatorConnection",
    "RetryRotator",
]);

export function recordDiagnosticAction(action) {
    if (diagnostic_actions.has(action)) {
        Sentry.addBreadcrumb({ category: "app.action", message: action, level: "info" });
    }
}

function sanitizeBreadcrumb(breadcrumb) {
    if (breadcrumb.category !== "app.action" || !diagnostic_actions.has(breadcrumb.message)) {
        return null;
    }
    return {
        category: "app.action",
        message: breadcrumb.message,
        level: "info",
        timestamp: breadcrumb.timestamp,
    };
}

function browserContexts() {
    const agent = globalThis.navigator?.userAgent ?? "";
    const contexts = {};
    for (const [name, pattern] of [
        ["Edge", /Edg\/(\d+(?:\.\d+){0,3})/],
        ["Firefox", /Firefox\/(\d+(?:\.\d+){0,3})/],
        ["Chrome", /Chrome\/(\d+(?:\.\d+){0,3})/],
        ["Safari", /Version\/(\d+(?:\.\d+){0,3}).*Safari/],
    ]) {
        const match = agent.match(pattern);
        if (match) {
            contexts.browser = { name, version: match[1] };
            break;
        }
    }
    for (const [name, pattern] of [
        ["Android", /Android/],
        ["iOS", /iPhone|iPad/],
        ["Windows", /Windows/],
        ["Mac OS X", /Macintosh/],
        ["Linux", /Linux/],
    ]) {
        if (pattern.test(agent)) {
            contexts.os = { name };
            break;
        }
    }
    return contexts;
}

function sanitizeContexts(contexts) {
    const safe = {};
    for (const key of ["browser", "os"]) {
        const value = contexts?.[key];
        const names =
            key === "browser"
                ? ["Chrome", "Chrome Mobile", "Firefox", "Safari", "Mobile Safari", "Edge", "Opera"]
                : ["Windows", "Mac OS X", "Linux", "Android", "iOS"];
        if (value && names.includes(value.name)) {
            safe[key] = { name: value.name };
            if (typeof value.version === "string" && /^\d+(?:\.\d+){0,3}$/.test(value.version)) {
                safe[key].version = value.version;
            }
        }
    }
    return Object.keys(safe).length ? safe : undefined;
}

function sanitizeSourceUrl(url) {
    if (typeof url !== "string") {
        return undefined;
    }

    let path;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
        path = parsed.pathname;
    } catch {
        path = url.split(/[?#]/)[0];
    }
    // Only shipped assets and repository source paths are diagnostic filenames.
    if (/^\/assets\/[A-Za-z0-9_-]{1,128}\.(?:js|css)$/.test(path)) return path;
    if (
        /^(?:\.\.\/){0,3}(?:src|node_modules)\/[A-Za-z0-9_@./-]{1,200}\.[cm]?[jt]sx?$/.test(path) &&
        !path
            .replace(/^(?:\.\.\/){0,3}/, "")
            .split("/")
            .includes("..")
    )
        return path;
    return undefined;
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

function sanitizeErrorMessage(message) {
    if (typeof message !== "string") return sanitized_message;

    if (/^Cannot read properties of (undefined|null)/.test(message)) {
        return message.startsWith("Cannot read properties of undefined")
            ? "Cannot read properties of undefined"
            : "Cannot read properties of null";
    }
    if (/^Cannot destructure property .* (null|undefined)/.test(message)) {
        return message.includes("undefined")
            ? "Cannot destructure property of undefined"
            : "Cannot destructure property of null";
    }
    if (/^(undefined|null) is not an object/.test(message)) {
        return message.startsWith("undefined")
            ? "Undefined is not an object"
            : "Null is not an object";
    }
    if (/^.* is not (iterable|a constructor)$/.test(message)) {
        return message.endsWith("iterable")
            ? "Value is not iterable"
            : "Value is not a constructor";
    }
    if (
        [
            "Cannot convert undefined or null to object",
            "Invalid array length",
            "Maximum call stack size exceeded",
        ].includes(message)
    ) {
        return message;
    }
    if (/^.* is not a function$/.test(message)) return "Value is not a function";
    if (/^.* is not defined$/.test(message)) return "Variable is not defined";
    if (/^Cannot access .* before initialization$/.test(message)) {
        return "Cannot access variable before initialization";
    }
    if (message === "Failed to fetch" || message === "Load failed") return message;
    if (/^Loading (chunk|CSS chunk) .* failed/.test(message)) return "Loading chunk failed";
    if (/^Failed to fetch dynamically imported module/.test(message)) {
        return "Failed to fetch dynamically imported module";
    }
    if (message === "ResizeObserver loop completed with undelivered notifications.") return message;
    return sanitized_message;
}

function sanitizeFunctionName(name) {
    return typeof name === "string" && /^[A-Za-z_$][A-Za-z_$.<> ]{0,127}$/.test(name)
        ? name
        : undefined;
}

function sanitizeExceptionType(type) {
    const native = [
        "Error",
        "TypeError",
        "RangeError",
        "ReferenceError",
        "SyntaxError",
        "URIError",
        "EvalError",
        "AggregateError",
        "DOMException",
    ];
    if (native.includes(type)) return type;
    if (
        typeof type === "string" &&
        type.startsWith("React ErrorBoundary ") &&
        native.includes(type.slice("React ErrorBoundary ".length))
    )
        return type;
    return "Error";
}

function sanitizeException(exception) {
    if (!exception?.values) {
        return exception;
    }

    return {
        ...exception,
        values: exception.values.map(value => ({
            type: sanitizeExceptionType(value.type),
            value: sanitizeErrorMessage(value.value),
            mechanism: value.mechanism && {
                type: sanitizeFunctionName(value.mechanism.type),
                handled:
                    typeof value.mechanism.handled === "boolean"
                        ? value.mechanism.handled
                        : undefined,
            },
            stacktrace: value.stacktrace && {
                frames: value.stacktrace.frames?.map(frame => ({
                    colno: frame.colno,
                    filename: sanitizeSourceUrl(frame.filename),
                    function: sanitizeFunctionName(frame.function),
                    lineno: frame.lineno,
                    in_app: typeof frame.in_app === "boolean" ? frame.in_app : undefined,
                })),
            },
        })),
    };
}

export function sanitizeSentryEvent(event, hint = {}) {
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

    // Recover an original stack when the SDK supplied only the React component stack.
    let exception = event.exception;
    const original = hint.originalException;
    if (
        original instanceof Error &&
        typeof original.stack === "string" &&
        exception?.values?.length
    ) {
        const last = exception.values.length - 1;
        if (!exception.values[last].stacktrace?.frames?.length) {
            const frames = Sentry.defaultStackParser(original.stack);
            if (frames.length) {
                exception = {
                    ...exception,
                    values: exception.values.map((value, index) =>
                        index === last ? { ...value, stacktrace: { frames } } : value,
                    ),
                };
            }
        }
    }
    const breadcrumbs = event.breadcrumbs?.map(sanitizeBreadcrumb).filter(Boolean).slice(-20);
    if (breadcrumbs?.length) sanitized_event.breadcrumbs = breadcrumbs;
    const contexts = sanitizeContexts(event.contexts);
    if (contexts) sanitized_event.contexts = contexts;
    sanitized_event.exception = sanitizeException(exception);
    sanitized_event.logentry = event.logentry && { message: sanitized_message };
    sanitized_event.message = event.message && sanitized_message;

    return sanitized_event;
}

export function initializeSentry(options = {}) {
    const settings = { ...default_options, ...options };

    if (!settings.dsn) {
        return false;
    }

    const browser_contexts = browserContexts();
    Sentry.init({
        dsn: settings.dsn,
        environment: settings.environment,
        release: settings.release,
        sendDefaultPii: false,
        autoSessionTracking: false,
        tracesSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        replaysSessionSampleRate: 0,
        beforeSend: (event, hint) =>
            sanitizeSentryEvent(
                {
                    ...event,
                    contexts: { ...browser_contexts, ...event.contexts },
                },
                hint,
            ),
        beforeBreadcrumb: sanitizeBreadcrumb,
    });

    return true;
}

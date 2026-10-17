import * as Sentry from "@sentry/react";

const default_options = {
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
    release: import.meta.env.VITE_SENTRY_RELEASE,
};

const sanitized_message = "Application error (message redacted)";

// Error-local evidence: never keep payloads or a global "last operation" that
// could be incorrectly attached to an unrelated failure.
const error_diagnostics = new WeakMap();
const dom_errors = new Set([
    "AbortError",
    "InvalidStateError",
    "TransactionInactiveError",
    "NotFoundError",
    "NotAllowedError",
    "SecurityError",
    "QuotaExceededError",
    "UnknownError",
    "VersionError",
    "ConstraintError",
    "DataError",
    "ReadOnlyError",
    "OperationError",
]);

// Evidence leaves the browser unchanged. Do not attach payloads or credentials.
export function annotateDiagnosticError(error, evidence) {
    if (error && (typeof error === "object" || typeof error === "function")) {
        error_diagnostics.set(error, { ...error_diagnostics.get(error), ...evidence });
    }
    return error;
}

export function recordBoundaryDiagnostics(_scope, error) {
    annotateDiagnosticError(error, {
        operation: error_diagnostics.get(error)?.operation ?? "react_boundary",
        boundary: true,
    });
}

function errorCategory(message, name) {
    if (dom_errors.has(name)) return name;
    if (typeof message !== "string") return "unknown";
    if (
        /Failed to execute '(insertBefore|appendChild|removeChild)'|not a child of this node/.test(
            message,
        )
    )
        return "dom_tree_mutation";
    if (/dynamically imported module|Loading (chunk|CSS chunk)/.test(message)) return "module_load";
    if (/fullscreen/i.test(message)) return "fullscreen";
    if (/^Minified React error #\d+;/.test(message)) return "react_invariant";
    const safe = sanitizeErrorMessage(message);
    return safe === sanitized_message ? "unknown" : safe;
}

function sourceClass(filename) {
    if (sanitizeSourceUrl(filename)) {
        try {
            const url = new URL(filename);
            return url.origin === globalThis.location?.origin
                ? "same_origin_asset_path"
                : "external_asset_path";
        } catch {
            return "relative_source_path";
        }
    }
    if (typeof filename !== "string") return "unknown";
    if (/^(chrome|moz|safari-web)-extension:/.test(filename)) return "extension";
    if (/^https?:/.test(filename)) {
        try {
            return new URL(filename).origin === globalThis.location?.origin
                ? "same_origin_url"
                : "cross_origin_url";
        } catch {
            return "inline_or_unrecognized";
        }
    }
    if (/^(?:file:|[A-Z]:\\|\/)/.test(filename)) return "local_or_unrecognized";
    return "inline_or_unrecognized";
}

function frameSourceEvidence(exception) {
    const sources = [];
    const values = exception?.values ?? [];
    // Keep indices because causes and frames can have no stack or filename.
    for (let exception_index = values.length - 1; exception_index >= 0; exception_index -= 1) {
        const frames = values[exception_index].stacktrace?.frames ?? [];
        for (let frame_index = frames.length - 1; frame_index >= 0; frame_index -= 1) {
            const filename = frames[frame_index].filename;
            sources.push({
                exception_index,
                frame_index,
                source_class: sourceClass(filename),
                filename_state:
                    typeof filename !== "string"
                        ? "absent"
                        : sanitizeSourceUrl(filename)
                          ? "retained"
                          : "removed",
            });
            if (sources.length === 50) return sources.reverse();
        }
    }
    return sources.reverse();
}

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
    "Stop",
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
    // These path shapes do not prove that a file belongs to this build.
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

function isNativeError(value) {
    const tag = Object.prototype.toString.call(value);
    return ["[object Error]", "[object DOMException]"].includes(tag);
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

    let exception = event.exception;
    const original = hint.originalException;
    const evidence = error_diagnostics.get(original) ?? {};
    // Sentry prepends causes (including the React component stack). The
    // original exception is the last non-boundary value, not the first.
    let primary_index = (exception?.values?.length ?? 0) - 1;
    while (
        primary_index >= 0 &&
        exception.values[primary_index].type?.startsWith("React ErrorBoundary ")
    ) {
        primary_index -= 1;
    }
    const boundary =
        error_diagnostics.get(original)?.boundary === true ||
        evidence.operation === "react_boundary" ||
        exception?.values?.some(value => value.type?.startsWith("React ErrorBoundary "));
    let original_frames;
    // Parse at most once. Ordinary exceptions already carrying a stack need
    // no duplicate payload. Keep a second stack only for a boundary whose SDK
    // representation does not already contain the underlying stack.
    if (
        isNativeError(original) &&
        typeof original.stack === "string" &&
        exception?.values?.length &&
        (boundary || !exception.values[primary_index]?.stacktrace?.frames?.length)
    ) {
        const frames = Sentry.defaultStackParser(original.stack);
        if (
            frames.length &&
            primary_index >= 0 &&
            !exception.values[primary_index].stacktrace?.frames?.length
        ) {
            exception = {
                ...exception,
                values: exception.values.map((value, index) =>
                    index === primary_index ? { ...value, stacktrace: { frames } } : value,
                ),
            };
        } else if (frames.length && boundary) {
            const recovered = sanitizeException({
                values: [{ stacktrace: { frames } }],
            }).values[0].stacktrace.frames.slice(-50);
            const already_present = sanitizeException(exception).values.some(
                value =>
                    JSON.stringify(value.stacktrace?.frames?.slice(-50)) ===
                    JSON.stringify(recovered),
            );
            if (!already_present) original_frames = recovered;
        }
    }
    const breadcrumbs = event.breadcrumbs?.map(sanitizeBreadcrumb).filter(Boolean).slice(-20);
    if (breadcrumbs?.length) sanitized_event.breadcrumbs = breadcrumbs;
    const contexts = sanitizeContexts(event.contexts) ?? {};
    const primary = exception?.values?.[primary_index] ?? exception?.values?.[0];
    const frames = exception?.values?.flatMap(value => value.stacktrace?.frames ?? []) ?? [];
    const mechanism = primary?.mechanism?.type;
    const capture_path = boundary
        ? "react_boundary"
        : mechanism === "auto.browser.global_handlers.onunhandledrejection"
          ? "unhandled_rejection"
          : mechanism === "auto.browser.global_handlers.onerror"
            ? "global_error"
            : "other";
    const diagnostic = {
        ...evidence,
        capture_path,
        original_kind: isNativeError(original)
            ? "error"
            : original === null
              ? "null"
              : typeof original,
        original_stack:
            isNativeError(original) && typeof original.stack === "string" && original.stack.length
                ? "present"
                : "absent",
        category: errorCategory(
            original?.message ?? primary?.value,
            original?.name ?? primary?.type,
        ),
        script_origins: [...new Set(frames.map(frame => sourceClass(frame.filename)))].slice(0, 5),
        frame_sources: frameSourceEvidence(exception),
    };
    const native_name = original?.name ?? primary?.type;
    if (dom_errors.has(native_name)) diagnostic.native_name = native_name;
    // Keep normal stack-based grouping, but do not combine boundary failures
    // with rejections that need a different investigation.
    if (!event.fingerprint && ["react_boundary", "unhandled_rejection"].includes(capture_path)) {
        sanitized_event.fingerprint = ["{{ default }}", capture_path];
    }
    diagnostic.native_bridge_frames = frames.some(frame =>
        ["sendDataToNative", "sendBeforeUnloadMessage"].includes(frame.function),
    );
    if (original_frames) diagnostic.original_frames = original_frames;
    if (diagnostic.category === "react_invariant") {
        const code = Number(
            (original?.message ?? primary?.value)?.match(/^Minified React error #(\d+);/)?.[1],
        );
        if (Number.isInteger(code) && code > 0 && code <= 1000) diagnostic.react_code = code;
    }
    // Inspect an import URL locally, but send only an already-allowed bundled
    // filename. Never send its host, query, fragment, or arbitrary path.
    const message = original?.message ?? primary?.value;
    if (diagnostic.category === "module_load" && typeof message === "string") {
        const import_url = message.match(/https?:\/\/\S+/)?.[0];
        const asset = sanitizeSourceUrl(import_url);
        if (asset?.startsWith("/assets/")) {
            diagnostic.asset = asset;
            diagnostic.asset_origin = sourceClass(import_url);
        }
        diagnostic.online =
            typeof globalThis.navigator?.onLine === "boolean"
                ? globalThis.navigator.onLine
                : undefined;
    }
    if (exception?.values?.length || original) contexts.diagnostic = diagnostic;
    if (Object.keys(contexts).length) sanitized_event.contexts = contexts;
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

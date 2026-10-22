import { isError, toError } from "@/utils/errors.js";
import * as Sentry from "@sentry/react";

const default_options = {
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
    release: import.meta.env.VITE_SENTRY_RELEASE,
};

// Error-local evidence prevents one operation from being attached to another failure.
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

export function annotateDiagnosticError(value, evidence) {
    const error = toError(value);
    error_diagnostics.set(error, { ...error_diagnostics.get(error), ...evidence });
    return error;
}

function originalKind(value) {
    return isError(value) ? "error" : value === null ? "null" : typeof value;
}

function addPrimitiveBoundaryStacks(event, error, component_stack) {
    const values = event.exception?.values ?? [];
    const primary = values.at(-1) ?? {};
    const capture_frames = Sentry.defaultStackParser(error.stack ?? "").slice(-50);
    const component_frames = Sentry.defaultStackParser(component_stack ?? "").slice(-50);
    const capture = {
        ...primary,
        type: error.name,
        value: error.message,
        stacktrace: { frames: capture_frames },
    };
    const component = {
        type: `React ErrorBoundary ${error.name}`,
        value: error.message,
        stacktrace: { frames: component_frames },
    };
    return {
        ...event,
        exception: {
            ...event.exception,
            values: [component, ...values.slice(0, -1), capture],
        },
    };
}

export function recordBoundaryDiagnostics(scope, value, component_stack) {
    const error = toError(value);
    const evidence = {
        ...error_diagnostics.get(error),
        operation: error_diagnostics.get(error)?.operation ?? "react_boundary",
        boundary: true,
        component_stack: component_stack ? "present" : "absent",
    };
    error_diagnostics.set(error, evidence);
    if (!scope?.addEventProcessor) return error;

    scope.addEventProcessor(event => {
        const prepared = isError(value)
            ? event
            : addPrimitiveBoundaryStacks(event, error, component_stack);
        return {
            ...prepared,
            contexts: {
                ...prepared.contexts,
                diagnostic: {
                    ...prepared.contexts?.diagnostic,
                    ...evidence,
                    original_kind: originalKind(value),
                    original_value: value,
                    original_stack:
                        isError(value) && typeof value.stack === "string" && value.stack.length
                            ? "present"
                            : "absent",
                    javascript_stack_origin: isError(value)
                        ? typeof value.stack === "string" && value.stack.length
                            ? "original"
                            : "absent"
                        : "synthetic_capture",
                    component_stack: component_stack ? "present" : "absent",
                },
            },
        };
    });
    return error;
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
    if (
        /dynamically imported module|Loading (chunk|CSS chunk)|^Importing a module script failed\.$/.test(
            message,
        )
    )
        return "module_load";
    if (/fullscreen/i.test(message)) return "fullscreen";
    if (/^Minified React error #\d+;/.test(message)) return "react_invariant";
    return "unknown";
}

function sourceClass(filename) {
    if (typeof filename !== "string") return "unknown";
    if (/^(chrome|moz|safari-web)-extension:/.test(filename)) return "extension";
    if (/^https?:/.test(filename)) {
        try {
            const url = new URL(filename);
            if (/^\/assets\//.test(url.pathname)) {
                return url.origin === globalThis.location?.origin
                    ? "same_origin_asset_path"
                    : "external_asset_path";
            }
            return url.origin === globalThis.location?.origin
                ? "same_origin_url"
                : "cross_origin_url";
        } catch {
            return "inline_or_unrecognized";
        }
    }
    if (/^\/assets\//.test(filename)) return "same_origin_asset_path";
    if (/^(?:file:|[A-Z]:\\|\/)/.test(filename)) return "local_or_unrecognized";
    if (/^(?:\.\.\/){0,3}(?:src|node_modules)\//.test(filename)) return "relative_source_path";
    return "inline_or_unrecognized";
}

function frameProvenance(frames) {
    const classes = frames.map(frame => sourceClass(frame.filename));
    const app = classes.some(value =>
        ["same_origin_asset_path", "same_origin_url", "relative_source_path"].includes(value),
    );
    const external = classes.some(value =>
        ["cross_origin_url", "external_asset_path", "extension"].includes(value),
    );
    if (app && external) return "mixed";
    if (app) return "app_frames";
    if (external) return "external_frames";
    return "unknown";
}

function frameSourceEvidence(exception) {
    const sources = [];
    const values = exception?.values ?? [];
    for (let exception_index = values.length - 1; exception_index >= 0; exception_index -= 1) {
        const frames = values[exception_index].stacktrace?.frames ?? [];
        for (let frame_index = frames.length - 1; frame_index >= 0; frame_index -= 1) {
            sources.push({
                exception_index,
                frame_index,
                source_class: sourceClass(frames[frame_index].filename),
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

function moduleAsset(message) {
    if (typeof message !== "string") return undefined;
    const raw_url = message.match(/https?:\/\/\S+/)?.[0];
    if (!raw_url) return undefined;
    try {
        const url = new URL(raw_url);
        if (/^\/assets\/[A-Za-z0-9_-]{1,128}\.(?:js|css)$/.test(url.pathname)) {
            return { path: url.pathname, origin: sourceClass(raw_url) };
        }
    } catch {}
    return undefined;
}

function isLazySecondary(primary, boundary, original_frames) {
    if (!boundary || primary?.type !== "TypeError" || original_frames?.length) return false;
    const message = primary.value ?? "";
    if (
        !/^undefined is not an object \(evaluating '[A-Za-z_$][\w$]*\._result\.default'\)$/.test(
            message,
        ) &&
        !/^can't access property "default", [A-Za-z_$][\w$]*\._result is undefined$/.test(message)
    )
        return false;
    const frame = primary.stacktrace?.frames?.at(-1);
    return (
        frame?.function === "T" && /(?:^|\/)react\.production\.min\.js$/.test(frame.filename ?? "")
    );
}

export function prepareSentryEvent(event, hint = {}) {
    const prepared_event = { ...event };
    let exception = event.exception;
    const original = hint.originalException;
    const boundary_evidence = event.contexts?.diagnostic ?? {};
    const evidence = { ...error_diagnostics.get(original), ...boundary_evidence };
    // Sentry prepends causes. The original exception is the last non-boundary value.
    let primary_index = (exception?.values?.length ?? 0) - 1;
    while (
        primary_index >= 0 &&
        exception.values[primary_index].type?.startsWith("React ErrorBoundary ")
    ) {
        primary_index -= 1;
    }
    const mechanisms = exception?.values?.map(value => value.mechanism?.type) ?? [];
    const boundary =
        evidence.boundary === true ||
        evidence.operation === "react_boundary" ||
        mechanisms.includes("auto.function.react.error_boundary") ||
        exception?.values?.some(value => value.type?.startsWith("React ErrorBoundary "));
    const has_original = Object.hasOwn(hint, "originalException");
    const needs_synthetic_stack =
        has_original &&
        !isError(original) &&
        !exception?.values?.some(value => value.type === "NonErrorThrown");
    if (needs_synthetic_stack && primary_index >= 0) {
        const normalized = toError(original);
        const frames = Sentry.defaultStackParser(normalized.stack ?? "").slice(-50);
        exception = {
            ...exception,
            values: exception.values.map((value, index) =>
                index === primary_index
                    ? {
                          ...value,
                          type: normalized.name,
                          value: normalized.message,
                          stacktrace: { frames },
                      }
                    : value,
            ),
        };
    }
    let original_frames;
    if (
        isError(original) &&
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
            const recovered = frames.slice(-50);
            const already_present = exception.values.some(
                value =>
                    JSON.stringify(value.stacktrace?.frames?.slice(-50)) ===
                    JSON.stringify(recovered),
            );
            if (!already_present) original_frames = recovered;
        }
    }

    const contexts = { ...event.contexts };
    const primary = exception?.values?.[primary_index] ?? exception?.values?.[0];
    const frames = exception?.values?.flatMap(value => value.stacktrace?.frames ?? []) ?? [];
    const capture_path = boundary
        ? "react_boundary"
        : mechanisms.includes("auto.browser.global_handlers.onunhandledrejection")
          ? "unhandled_rejection"
          : mechanisms.includes("auto.browser.global_handlers.onerror")
            ? "global_error"
            : "other";
    const diagnostic = {
        ...evidence,
        capture_path,
        original_kind: evidence.original_kind ?? originalKind(original),
        original_value: evidence.original_value ?? (has_original ? original : undefined),
        original_stack:
            evidence.original_stack ??
            (isError(original) && typeof original.stack === "string" && original.stack.length
                ? "present"
                : "absent"),
        javascript_stack_origin:
            evidence.javascript_stack_origin ??
            (isError(original)
                ? typeof original.stack === "string" && original.stack.length
                    ? "original"
                    : "absent"
                : needs_synthetic_stack
                  ? "synthetic_capture"
                  : "absent"),
        category: errorCategory(
            original?.message ?? primary?.value,
            original?.name ?? primary?.type,
        ),
        script_origins: [...new Set(frames.map(frame => sourceClass(frame.filename)))].slice(0, 5),
        frame_sources: frameSourceEvidence(exception),
        provenance: frameProvenance(frames),
    };
    if (isLazySecondary(primary, boundary, original_frames)) {
        diagnostic.category = "react_lazy_secondary";
        if (!event.fingerprint) {
            prepared_event.fingerprint = ["react_lazy_secondary", capture_path];
        }
    }
    const native_name = original?.name ?? primary?.type;
    if (dom_errors.has(native_name)) diagnostic.native_name = native_name;
    if (
        !prepared_event.fingerprint &&
        ["react_boundary", "unhandled_rejection", "global_error"].includes(capture_path)
    ) {
        prepared_event.fingerprint = ["{{ default }}", capture_path];
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
    if (diagnostic.category === "module_load") {
        const asset = moduleAsset(original?.message ?? primary?.value);
        if (asset) {
            diagnostic.asset = asset.path;
            diagnostic.asset_origin = asset.origin;
        }
        diagnostic.online =
            typeof globalThis.navigator?.onLine === "boolean"
                ? globalThis.navigator.onLine
                : undefined;
    }
    if (exception?.values?.length || original) contexts.diagnostic = diagnostic;
    if (Object.keys(contexts).length) prepared_event.contexts = contexts;
    prepared_event.exception = exception;

    return prepared_event;
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
        beforeSend: prepareSentryEvent,
    });

    return true;
}

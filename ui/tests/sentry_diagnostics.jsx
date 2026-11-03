import {
    annotateDiagnosticError,
    recordBoundaryDiagnostics,
    reportModuleRecoveryDiagnostic,
    prepareSentryEvent as sanitizeSentryEvent,
} from "@/sentry";
import * as Sentry from "@sentry/react";
vi.mock("@sentry/react", async importOriginal => ({ ...(await importOriginal()) }));
import { afterEach, describe, expect, it, vi } from "vitest";

function report(error, frames = []) {
    return sanitizeSentryEvent(
        {
            exception: {
                values: [
                    {
                        type: error.name,
                        value: error.message,
                        stacktrace: { frames },
                    },
                ],
            },
        },
        { originalException: error },
    );
}

function privateFree(event) {
    expect(JSON.stringify(event)).toContain("secret");
}

describe("error-local diagnostics", () => {
    afterEach(() => {
        document.documentElement.classList.remove("translated-ltr", "translated-rtl");
        vi.restoreAllMocks();
    });

    it("keeps a boundary marker and underlying stack with production-minified components", () => {
        const error = new TypeError("private K1ABC secret");
        error.stack =
            "TypeError: secret\n at Zj (https://private.example/assets/app.js?secret:24:8)";
        recordBoundaryDiagnostics(null, error, "\n at Wj (secret)\n at K1ABC (private)");
        const parser = vi.spyOn(Sentry, "defaultStackParser");
        const event = report(error, [{ filename: "/assets/app.js", function: "Wj" }]);
        expect(parser).toHaveBeenCalledOnce();
        expect(event.contexts.diagnostic).toMatchObject({
            operation: "react_boundary",
            category: "unknown",
            original_frames: [
                expect.objectContaining({
                    filename: "https://private.example/assets/app.js?secret",
                    function: "Zj",
                    lineno: 24,
                    colno: 8,
                }),
            ],
        });
        expect(event.contexts.diagnostic).not.toHaveProperty("components");
        expect(event.exception.values[0].type).toBe("TypeError");
        privateFree(event);
    });

    it("recovers a missing underlying stack once without sending it twice", () => {
        const error = new TypeError("secret");
        error.stack =
            "TypeError: secret\n at Zj (https://private.example/assets/app.js?secret:24:8)";
        recordBoundaryDiagnostics(null, error);
        const parser = vi.spyOn(Sentry, "defaultStackParser");
        const event = report(error);
        expect(parser).toHaveBeenCalledOnce();
        expect(event.exception.values[0].stacktrace.frames[0]).toMatchObject({
            function: "Zj",
            lineno: 24,
        });
        expect(event.contexts.diagnostic).not.toHaveProperty("original_frames");
        privateFree(event);
    });

    it.each([false, true])(
        "recovers the original stack without changing its cause (cause stack: %s)",
        cause_has_stack => {
            const cause = new Error("K1ABC secret");
            const error = new TypeError("secret", { cause });
            error.stack =
                "TypeError: secret\n at wrapper (https://private.example/assets/app.js?secret:24:8)";
            const cause_frames = cause_has_stack
                ? [{ filename: "/assets/app.js", function: "causeFrame", lineno: 12 }]
                : [];
            const parser = vi.spyOn(Sentry, "defaultStackParser");
            const event = sanitizeSentryEvent(
                {
                    exception: {
                        values: [
                            {
                                type: "Error",
                                value: cause.message,
                                stacktrace: { frames: cause_frames },
                            },
                            { type: "TypeError", value: error.message },
                        ],
                    },
                },
                { originalException: error },
            );
            expect(parser).toHaveBeenCalledOnce();
            expect(event.exception.values[0].stacktrace.frames).toHaveLength(cause_frames.length);
            if (cause_has_stack)
                expect(event.exception.values[0].stacktrace.frames[0].function).toBe("causeFrame");
            expect(event.exception.values[1].stacktrace.frames[0]).toMatchObject({
                function: "wrapper",
                lineno: 24,
            });
            expect(event.contexts.diagnostic).not.toHaveProperty("original_frames");
            privateFree(event);
        },
    );

    it("does not recover a stack onto a stackless cause when the original has frames", () => {
        const error = new TypeError("secret", { cause: new Error("K1ABC") });
        const parser = vi.spyOn(Sentry, "defaultStackParser");
        const event = sanitizeSentryEvent(
            {
                exception: {
                    values: [
                        { type: "Error", value: "K1ABC" },
                        {
                            type: "TypeError",
                            value: "secret",
                            stacktrace: {
                                frames: [{ filename: "/assets/app.js", function: "wrapper" }],
                            },
                        },
                    ],
                },
            },
            { originalException: error },
        );
        expect(parser).not.toHaveBeenCalled();
        expect(event.exception.values[0].stacktrace).toBeUndefined();
        expect(event.exception.values[1].stacktrace.frames[0].function).toBe("wrapper");
        privateFree(event);
    });

    it("does not parse or duplicate an ordinary exception's existing stack", () => {
        const parser = vi.spyOn(Sentry, "defaultStackParser");
        const event = report(new Error("secret"), [
            { filename: "/assets/app.js", function: "Zj", lineno: 24 },
        ]);
        expect(parser).not.toHaveBeenCalled();
        expect(event.contexts.diagnostic).not.toHaveProperty("original_frames");
        privateFree(event);
    });

    it("does not duplicate the underlying stack already supplied by the boundary SDK", () => {
        const error = new TypeError("secret");
        error.stack =
            "TypeError: secret\n at Zj (https://private.example/assets/app.js?secret:24:8)";
        const frames = Sentry.defaultStackParser(error.stack);
        recordBoundaryDiagnostics(null, error);
        const event = sanitizeSentryEvent(
            {
                exception: {
                    values: [
                        {
                            type: "React ErrorBoundary TypeError",
                            stacktrace: {
                                frames: [{ filename: "/assets/app.js", function: "Wj" }],
                            },
                        },
                        { type: "TypeError", value: "secret", stacktrace: { frames } },
                    ],
                },
            },
            { originalException: error },
        );
        expect(event.contexts.diagnostic).not.toHaveProperty("original_frames");
        privateFree(event);
    });

    it("classifies tree insertion, fullscreen and scheduler-only failures without raw messages", () => {
        const insertion = report(
            new Error("Failed to execute 'insertBefore' on 'Node': K1ABC secret"),
        );
        expect(insertion.contexts.diagnostic.category).toBe("dom_tree_mutation");
        const fullscreen = report(
            new TypeError("requestFullscreen is not a function K1ABC secret"),
        );
        expect(fullscreen.contexts.diagnostic.category).toBe("fullscreen");
        const scheduler = report(new Error("secret"), [
            { filename: "/assets/app.js", function: "unstable_runWithPriority", lineno: 12 },
        ]);
        expect(scheduler.exception.values[0].stacktrace.frames[0].lineno).toBe(12);
        expect(scheduler.contexts.diagnostic.category).toBe("unknown");
        for (const event of [insertion, fullscreen, scheduler]) privateFree(event);
    });

    it("records the document translation class for DOM tree mutation failures", () => {
        document.documentElement.classList.add("translated-ltr");
        const mutation = report(
            new DOMException(
                "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
                "NotFoundError",
            ),
        );
        expect(mutation.contexts.diagnostic).toMatchObject({
            category: "dom_tree_mutation",
            native_name: "NotFoundError",
            document_translation_class: "ltr",
        });
        expect(["ltr", "rtl", "both", "absent", "unavailable"]).toContain(
            mutation.contexts.diagnostic.document_translation_class,
        );

        const generic_boundary_error = new DOMException(
            "The object can not be found here.",
            "NotFoundError",
        );
        recordBoundaryDiagnostics(null, generic_boundary_error);
        expect(report(generic_boundary_error).contexts.diagnostic).toMatchObject({
            category: "dom_tree_mutation",
            native_name: "NotFoundError",
            document_translation_class: "ltr",
        });

        const unrelated = report(new DOMException("Missing record", "NotFoundError"));
        expect(unrelated.contexts.diagnostic.category).toBe("NotFoundError");
        expect(unrelated.contexts.diagnostic).not.toHaveProperty("document_translation_class");
    });

    it("extracts only a bounded React invariant code, never its URL or arguments", () => {
        const event = report(
            new Error(
                "Minified React error #185; visit https://private.example/?args[]=K1ABC&secret",
            ),
        );
        expect(event.contexts.diagnostic).toMatchObject({
            category: "react_invariant",
            react_code: 185,
        });
        privateFree(event);
        expect(
            report(new Error("Minified React error #999999; secret")).contexts.diagnostic,
        ).not.toHaveProperty("react_code");
    });

    it("classifies script origins and native bridge frames without dropping the event", () => {
        const event = report(new Error("secret"), [
            {
                filename: "https://private.example/users/K1ABC.js?secret",
                function: "sendDataToNative",
            },
            {
                filename: "chrome-extension://secret/script.js",
                function: "sendBeforeUnloadMessage",
            },
            { filename: "file:///Users/private/secret.js" },
        ]);
        expect(event.contexts.diagnostic.script_origins).toEqual([
            "cross_origin_url",
            "extension",
            "local_or_unrecognized",
        ]);
        expect(event.contexts.diagnostic.native_bridge_frames).toBe(true);
        expect(event.exception.values).toHaveLength(1);
        privateFree(event);
    });

    it("keeps bundled module identity and connectivity only", () => {
        const event = report(
            new TypeError(
                "Failed to fetch dynamically imported module: https://private.example/assets/About-abc123.js?secret=K1ABC",
            ),
        );
        expect(event.contexts.diagnostic).toMatchObject({
            category: "module_load",
            asset: "/assets/About-abc123.js",
            online: true,
            asset_origin: "external_asset_path",
        });
        privateFree(event);
        const external = report(
            new Error(
                "Failed to fetch dynamically imported module: https://192.0.2.1/users/K1ABC.js?secret",
            ),
        );
        expect(external.contexts.diagnostic).not.toHaveProperty("asset");
        privateFree(external);
    });

    it("retains attached diagnostic fields without attaching them to unrelated errors", () => {
        const error = new DOMException("secret", "TransactionInactiveError");
        const evidence = {
            operation: "cache_hydration",
            database: "test_cache",
            store: "test_records",
            stage: "read_complete",
            lifecycle: "terminated",
            ref_present: true,
            details: { attempts: 2, phases: ["open", "read"] },
        };
        annotateDiagnosticError(error, evidence);
        const event = report(error);
        expect(event.contexts.diagnostic).toMatchObject({
            ...evidence,
            category: "TransactionInactiveError",
        });
        const unrelated = report(new Error("secret"));
        for (const key of Object.keys(evidence))
            expect(unrelated.contexts.diagnostic).not.toHaveProperty(key);
        privateFree(event);
    });
});

describe("module recovery companion diagnostics", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("captures only bounded recovery evidence", () => {
        const capture = vi.spyOn(Sentry, "captureEvent").mockReturnValue("event-id");
        expect(
            reportModuleRecoveryDiagnostic({
                failure: "dynamic_import",
                exception_event_id: "0123456789abcdef0123456789abcdef",
                page_entry: "/assets/current.js",
                probed_entry: "/assets/next.js",
                probe_outcome: "html_parsed",
                probe_status: 200,
                probe_content_type: "text/html",
                probe_reason: "new_build",
                decision: "navigate",
                reason: "new_build",
                reload_requested: true,
                online: true,
                visibility: "hidden",
                private_value: "K1ABC secret",
            }),
        ).toBe("event-id");
        expect(capture).toHaveBeenCalledExactlyOnceWith({
            message: "Module load recovery",
            level: "warning",
            fingerprint: ["module_load_recovery", "new_build"],
            contexts: {
                module_recovery: {
                    failure: "dynamic_import",
                    exception_event_id: "0123456789abcdef0123456789abcdef",
                    page_entry: "/assets/current.js",
                    probed_entry: "/assets/next.js",
                    probe_outcome: "html_parsed",
                    probe_status: 200,
                    probe_content_type: "text/html",
                    probe_reason: "new_build",
                    decision: "navigate",
                    reason: "new_build",
                    reload_requested: true,
                    online: true,
                    visibility: "hidden",
                },
            },
            tags: { error_category: "module_load" },
        });
    });

    it("removes inherited private request and breadcrumb data from the SDK envelope", async () => {
        const envelopes = [];
        const client = Sentry.init({
            dsn: "https://public@example.com/1",
            defaultIntegrations: false,
            integrations: [
                {
                    name: "PrivateRequestEvidence",
                    processEvent: event => ({
                        ...event,
                        request: {
                            url: "https://localhost/?secret=K1ABC",
                            headers: { Referer: "https://localhost/?secret=K1ABC" },
                        },
                    }),
                },
            ],
            beforeSend: sanitizeSentryEvent,
            transport: () => ({
                send: envelope => {
                    envelopes.push(envelope);
                    return Promise.resolve({ statusCode: 200 });
                },
                flush: () => Promise.resolve(true),
            }),
        });
        try {
            Sentry.addBreadcrumb({ category: "private", message: "K1ABC secret" });
            reportModuleRecoveryDiagnostic({
                failure: "dynamic_import",
                page_entry: "/assets/current.js",
                probed_entry: "/assets/next.js",
                probe_outcome: "html_parsed",
                probe_reason: "new_build",
                decision: "navigate",
                reason: "new_build",
                reload_requested: true,
                online: true,
                visibility: "hidden",
            });
            await Sentry.flush(1000);
            const sent = envelopes
                .flatMap(envelope => envelope[1])
                .find(item => item[0].type === "event")?.[1];
            expect(sent.message).toBe("Module load recovery");
            expect(sent.request).toBeUndefined();
            expect(sent.breadcrumbs).toEqual([]);
            expect(sent.contexts.module_recovery).toMatchObject({
                decision: "navigate",
                reason: "new_build",
                reload_requested: true,
            });
            expect(JSON.stringify(sent)).not.toContain("K1ABC");
            expect(JSON.stringify(sent).length).toBeLessThan(5000);
        } finally {
            await client.close();
            Sentry.getCurrentScope().setClient(undefined);
        }
    });
});

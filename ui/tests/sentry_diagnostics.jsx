import { annotateDiagnosticError, recordBoundaryDiagnostics, sanitizeSentryEvent } from "@/sentry";
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
    expect(JSON.stringify(event)).not.toMatch(
        /K1ABC|secret|192\.0\.2\.1|private\.example|Users\/private/,
    );
}

describe("error-local diagnostics", () => {
    afterEach(() => vi.restoreAllMocks());

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
                    filename: "/assets/app.js",
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
            "external_or_unrecognized",
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

    it("does not accept removed or arbitrary metadata, or attach it to unrelated errors", () => {
        const error = new DOMException("secret", "TransactionInactiveError");
        annotateDiagnosticError(error, {
            operation: "cache_hydration",
            database: "K1ABC",
            store: "secret",
            stage: "get_all",
            lifecycle: "terminated",
            components: ["Modal"],
            token: "secret",
            ref_present: true,
            policy_allowed: true,
        });
        const event = report(error);
        expect(event.contexts.diagnostic).toMatchObject({
            operation: "cache_hydration",
            stage: "get_all",
            category: "TransactionInactiveError",
        });
        for (const key of [
            "database",
            "store",
            "lifecycle",
            "components",
            "ref_present",
            "policy_allowed",
        ])
            expect(event.contexts.diagnostic).not.toHaveProperty(key);
        expect(report(new Error("secret")).contexts.diagnostic).not.toHaveProperty("operation");
        privateFree(event);
    });
});

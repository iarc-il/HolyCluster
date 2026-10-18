import {
    annotateDiagnosticError,
    recordBoundaryDiagnostics,
    prepareSentryEvent as sanitizeSentryEvent,
} from "@/sentry";
import { describe, expect, it } from "vitest";

function report(error, mechanism = "auto.browser.global_handlers.onunhandledrejection") {
    return sanitizeSentryEvent(
        {
            exception: {
                values: [
                    {
                        type: "Error",
                        value: "secret",
                        mechanism: { type: mechanism, handled: false },
                    },
                ],
            },
        },
        { originalException: error },
    );
}

describe("failure origin diagnostics", () => {
    it("adds synthetic and component stacks for a primitive boundary failure", () => {
        let processor;
        const scope = { addEventProcessor: callback => (processor = callback) };
        const component_stack = "\n at PrimitiveComponent (https://example.com/assets/app.js:12:7)";
        recordBoundaryDiagnostics(scope, "diagnostic primitive failure", component_stack);
        const boundary_event = processor({
            exception: {
                values: [
                    {
                        type: "Error",
                        value: "diagnostic primitive failure",
                        mechanism: {
                            type: "auto.function.react.error_boundary",
                            handled: true,
                        },
                    },
                ],
            },
        });
        const event = sanitizeSentryEvent(boundary_event, {
            originalException: "diagnostic primitive failure",
        });

        expect(event.contexts.diagnostic).toMatchObject({
            capture_path: "react_boundary",
            original_kind: "string",
            original_stack: "absent",
            javascript_stack_origin: "synthetic_capture",
            component_stack: "present",
        });
        expect(event.exception.values).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: "React ErrorBoundary NonErrorThrown",
                    stacktrace: { frames: expect.any(Array) },
                }),
                expect.objectContaining({
                    type: "NonErrorThrown",
                    value: "diagnostic primitive failure",
                    mechanism: {
                        type: "auto.function.react.error_boundary",
                        handled: true,
                    },
                    stacktrace: { frames: expect.any(Array) },
                }),
            ]),
        );
        for (const value of event.exception.values) {
            expect(value.stacktrace.frames.length).toBeGreaterThan(0);
        }
    });

    it("separates boundary captures from unhandled rejections without merging default groups", () => {
        const error = new Error("secret");
        const rejection = report(error);
        recordBoundaryDiagnostics(null, error);
        const boundary = report(error, "generic");
        expect(rejection.contexts.diagnostic.capture_path).toBe("unhandled_rejection");
        expect(boundary.contexts.diagnostic.capture_path).toBe("react_boundary");
        expect(rejection.fingerprint).toEqual(["{{ default }}", "unhandled_rejection"]);
        expect(boundary.fingerprint).toEqual(["{{ default }}", "react_boundary"]);
    });

    it("retains cross-realm error stacks without treating objects or primitive rejections as Errors", () => {
        const frame = document.createElement("iframe");
        document.body.append(frame);
        try {
            const error = new frame.contentWindow.TypeError("secret");
            error.stack =
                "TypeError: secret\n at process_message (https://private.example/assets/app.js:12:7)";
            const event = report(error);
            expect(event.contexts.diagnostic.original_kind).toBe("error");
            expect(event.contexts.diagnostic.original_stack).toBe("present");
            expect(event.exception.values[0].stacktrace.frames[0]).toMatchObject({
                filename: "https://private.example/assets/app.js",
                lineno: 12,
            });
            expect(report("secret").contexts.diagnostic).toMatchObject({
                original_kind: "string",
                original_stack: "absent",
            });
            expect(report({ stack: error.stack }).contexts.diagnostic.original_kind).toBe("object");
        } finally {
            frame.remove();
        }
    });

    it("keeps original absence explicit and preserves an existing fingerprint", () => {
        const error = new Error("secret");
        error.stack = undefined;
        const event = sanitizeSentryEvent(
            { fingerprint: ["existing"], exception: { values: [{ type: "Error" }] } },
            { originalException: error },
        );
        expect(event.contexts.diagnostic).toMatchObject({
            original_kind: "error",
            original_stack: "absent",
        });
        expect(event.fingerprint).toEqual(["existing"]);
    });

    it("retains cache and WebSocket evidence through a boundary", () => {
        const error = new DOMException("secret", "InvalidStateError");
        annotateDiagnosticError(error, {
            operation: "cache_hydration",
            stage: "transaction",
            requested_version: 1,
            observed_version: 2,
            expected_store_present: true,
        });
        expect(report(error).contexts.diagnostic).toMatchObject({
            stage: "transaction",
            native_name: "InvalidStateError",
            requested_version: 1,
            observed_version: 2,
            expected_store_present: true,
        });
        const ws_error = new TypeError("secret");
        annotateDiagnosticError(ws_error, {
            operation: "websocket_message",
            stage: "subscriber",
            message_type: "radio",
            transport: "unified",
        });
        expect(report(ws_error).contexts.diagnostic).toMatchObject({
            operation: "websocket_message",
            stage: "subscriber",
            message_type: "radio",
            transport: "unified",
        });
        recordBoundaryDiagnostics(null, ws_error);
        expect(report(ws_error).contexts.diagnostic).toMatchObject({
            operation: "websocket_message",
            capture_path: "react_boundary",
        });
        expect(JSON.stringify(report(ws_error))).toContain("secret");
    });
});

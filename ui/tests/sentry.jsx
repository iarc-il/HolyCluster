import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { init } = vi.hoisted(() => ({
    init: vi.fn(),
}));

vi.mock("@sentry/react", async importOriginal => ({
    ...(await importOriginal()),
    init,
}));

import RouteErrorBoundary from "@/components/RouteErrorBoundary.jsx";
import {
    initializeSentry,
    recordDiagnosticAction,
    prepareSentryEvent as sanitizeSentryEvent,
} from "@/sentry";
import { toError } from "@/utils/errors.js";

function ThrowError() {
    throw new Error("sensitive callsign data");
}

function ThrowNormalizedPrimitive() {
    throw toError("out of memory");
}

let mount_count = 0;

function ThrowOnceOnMount() {
    React.useEffect(() => {
        mount_count += 1;

        if (mount_count === 1) {
            throw new Error("retry me");
        }
    }, []);

    return <p>Recovered</p>;
}

describe("Sentry error reporting", () => {
    afterEach(() => {
        cleanup();
        init.mockReset();
        mount_count = 0;
        vi.restoreAllMocks();
    });

    it("does not initialize without a DSN", () => {
        expect(initializeSentry({ dsn: undefined })).toBe(false);
        expect(init).not.toHaveBeenCalled();
    });

    it("disables tracing and replay when configured", () => {
        expect(
            initializeSentry({
                dsn: "https://public@holycluster-dev.iarc.org/errors/1",
                environment: "prod",
                release: "abcdef",
            }),
        ).toBe(true);

        expect(init).toHaveBeenCalledWith(
            expect.objectContaining({
                dsn: "https://public@holycluster-dev.iarc.org/errors/1",
                environment: "prod",
                release: "abcdef",
                sendDefaultPii: false,
                autoSessionTracking: false,
                tracesSampleRate: 0,
                replaysOnErrorSampleRate: 0,
                replaysSessionSampleRate: 0,
            }),
        );
    });

    it("does not collect the user agent in the event adapter", () => {
        vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
            "Mozilla/5.0 (Windows NT 10.0; private) Chrome/144.0.0.0 token=secret",
        );
        initializeSentry({ dsn: "https://public@example.com/1" });
        const event = init.mock.calls[0][0].beforeSend({ exception: { values: [] } });
        expect(event.contexts).toBeUndefined();
        expect(JSON.stringify(event)).not.toContain(window.navigator.userAgent);
    });

    it("preserves complete SDK event data", () => {
        const input = {
            breadcrumbs: [{ message: "diagnostic breadcrumb" }],
            contexts: { profile: { callsign: "K1ABC" } },
            exception: {
                values: [
                    {
                        stacktrace: {
                            frames: [
                                {
                                    context_line: "diagnostic context",
                                    filename: "https://example.com/assets/app.js?build=diagnostic",
                                    function: "diagnosticFunction",
                                    lineno: 12,
                                },
                            ],
                        },
                        value: "diagnostic failure",
                    },
                ],
            },
            extra: { nested: { marker: "diagnostic extra" } },
            logentry: { message: "diagnostic log entry" },
            message: "diagnostic message",
            request: { headers: { authorization: "diagnostic authorization" } },
            tags: { marker: "diagnostic tag" },
            user: { email: "diagnostic@example.com" },
        };
        const event = sanitizeSentryEvent(input);

        expect(event).toMatchObject(input);
        expect(event.contexts.diagnostic.category).toBe("unknown");
        expect(event.exception.values[0].stacktrace.frames[0]).toEqual(
            input.exception.values[0].stacktrace.frames[0],
        );
    });

    it("preserves native error categories and recovers a missing original stack", () => {
        const original = new TypeError(
            "Cannot destructure property 'token' of 'secret' as it is null.",
        );
        original.stack =
            "TypeError: private\n    at MainContent (https://example.com/assets/app.js?token=secret:42:7)";
        const event = sanitizeSentryEvent(
            {
                exception: { values: [{ type: "TypeError", value: original.message }] },
            },
            { originalException: original },
        );
        expect(event.exception.values[0].value).toBe(original.message);
        expect(event.exception.values[0].stacktrace.frames[0]).toMatchObject({
            filename: "https://example.com/assets/app.js?token=secret",
            lineno: 42,
            colno: 7,
        });
    });

    it("preserves custom error names and local filenames in recovered stacks", () => {
        for (const filename of [
            "file:///home/private/secret.js",
            "C:\\Users\\private\\secret.js",
            "/dev/secret.js",
            "https://example.com/users/secret/app.js",
        ]) {
            const original = new Error("secret");
            original.stack = `Error: secret\n    at MainContent (${filename}:42:7)`;
            const event = sanitizeSentryEvent(
                {
                    exception: { values: [{ type: "token-secret-K1ABC", value: "secret" }] },
                },
                { originalException: original },
            );
            expect(event.exception.values[0].type).toBe("token-secret-K1ABC");
            expect(event.exception.values[0].stacktrace.frames[0].filename).toContain(filename);
        }
    });

    it("keeps both component and original stacks when already present", () => {
        const frame = { filename: "/assets/app.js", function: "MainContent", lineno: 42 };
        const event = sanitizeSentryEvent(
            {
                exception: {
                    values: [
                        { type: "React ErrorBoundary TypeError", stacktrace: { frames: [frame] } },
                        {
                            type: "TypeError",
                            value: "Cannot convert undefined or null to object",
                            stacktrace: { frames: [frame] },
                        },
                    ],
                },
            },
            { originalException: new Error("other") },
        );
        expect(event.exception.values).toHaveLength(2);
        for (const exception of event.exception.values) {
            expect(exception.stacktrace.frames[0].lineno).toBe(42);
        }
        expect(event.exception.values[1].value).toBe("Cannot convert undefined or null to object");
    });

    it("preserves breadcrumbs and contexts", () => {
        const input = {
            breadcrumbs: [
                { category: "app.action", message: "tour_stopped", data: { callsign: "K1ABC" } },
                { category: "console", message: "secret" },
                { category: "app.action", message: "secret" },
            ],
            contexts: {
                browser: { name: "Firefox", version: "144.0", token: "secret" },
                os: { name: "Windows", version: "10" },
                profile: { callsign: "K1ABC" },
            },
        };
        const event = sanitizeSentryEvent(input);
        expect(event.breadcrumbs).toEqual(input.breadcrumbs);
        expect(event.contexts).toMatchObject(input.contexts);
        expect(() => recordDiagnosticAction("tour_stopped")).not.toThrow();
        expect(() => recordDiagnosticAction("secret")).not.toThrow();
    });

    it("shows the fallback and reports a rendering failure", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});

        render(
            <RouteErrorBoundary>
                <ThrowError />
            </RouteErrorBoundary>,
        );

        expect(screen.getByRole("alert").textContent).toContain("Something went wrong");
    });

    it("reports normalized primitive failures without a secondary Sentry error", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});

        expect(() =>
            render(
                <RouteErrorBoundary>
                    <ThrowNormalizedPrimitive />
                </RouteErrorBoundary>,
            ),
        ).not.toThrow();
        expect(screen.getByRole("alert")).not.toBeNull();
    });

    it("remounts the failed tree when retrying", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});

        render(
            <RouteErrorBoundary>
                <ThrowOnceOnMount />
            </RouteErrorBoundary>,
        );

        fireEvent.click(screen.getByRole("button", { name: "Try again" }));

        expect(screen.getByText("Recovered")).not.toBeNull();
        expect(mount_count).toBe(2);
    });
});

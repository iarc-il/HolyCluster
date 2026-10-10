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
import { initializeSentry, recordDiagnosticAction, sanitizeSentryEvent } from "@/sentry";

function ThrowError() {
    throw new Error("sensitive callsign data");
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

    it("adds browser diagnostics without sending the raw user agent", () => {
        vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
            "Mozilla/5.0 (Windows NT 10.0; private) Chrome/144.0.0.0 token=secret",
        );
        initializeSentry({ dsn: "https://public@example.com/1" });
        const event = init.mock.calls[0][0].beforeSend({ exception: { values: [] } });
        expect(event.contexts).toEqual({
            browser: { name: "Chrome", version: "144.0.0.0" },
            os: { name: "Windows" },
        });
        expect(JSON.stringify(event)).not.toMatch(/secret|private|token/);
    });

    it("removes sensitive event data before sending", () => {
        const event = sanitizeSentryEvent({
            breadcrumbs: [{ message: "K1ABC" }],
            contexts: { profile: { callsign: "K1ABC" } },
            exception: {
                values: [
                    {
                        stacktrace: {
                            frames: [
                                {
                                    context_line: "K1ABC",
                                    filename: "https://example.com/assets/app.js?callsign=K1ABC",
                                    function: "operatorK1ABC",
                                    lineno: 12,
                                },
                            ],
                        },
                        value: "K1ABC failed",
                    },
                ],
            },
            extra: { callsign: "K1ABC", nested: { token: "secret" } },
            logentry: { message: "K1ABC failed" },
            message: "K1ABC failed",
            request: { headers: { authorization: "secret" }, url: "https://example.com/?K1ABC" },
            tags: { callsign: "K1ABC" },
            user: { email: "operator@example.com" },
        });

        expect(event).not.toHaveProperty("breadcrumbs");
        expect(event).not.toHaveProperty("contexts");
        expect(event).not.toHaveProperty("request");
        expect(event).not.toHaveProperty("tags");
        expect(event).not.toHaveProperty("user");
        expect(event.exception.values[0].value).toBe("Application error (message redacted)");
        expect(event.exception.values[0].stacktrace.frames[0]).toEqual({
            filename: "/assets/app.js",
            lineno: 12,
        });
        expect(event.extra).toEqual({
            callsign: "[redacted]",
            nested: { token: "[redacted]" },
        });
        expect(event.logentry).toEqual({ message: "Application error (message redacted)" });
        expect(event.message).toBe("Application error (message redacted)");
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
        expect(event.exception.values[0].value).toBe("Cannot destructure property of null");
        expect(event.exception.values[0].stacktrace.frames[0]).toMatchObject({
            filename: "/assets/app.js",
            lineno: 42,
            colno: 7,
        });
        expect(JSON.stringify(event)).not.toContain("secret");
        expect(JSON.stringify(event)).not.toContain("token");
    });

    it("redacts custom error names and local filenames in recovered stacks", () => {
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
            expect(event.exception.values[0].type).toBe("Error");
            expect(JSON.stringify(event)).not.toMatch(/secret|private|K1ABC|Users/);
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

    it("retains only approved action history and browser context", () => {
        const event = sanitizeSentryEvent({
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
        });
        expect(event.breadcrumbs).toEqual([
            { category: "app.action", message: "tour_stopped", level: "info" },
        ]);
        expect(event.contexts).toEqual({
            browser: { name: "Firefox", version: "144.0" },
            os: { name: "Windows", version: "10" },
        });
        expect(JSON.stringify(event)).not.toMatch(/secret|K1ABC|token/);
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

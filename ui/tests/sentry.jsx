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
import { initializeSentry, sanitizeSentryEvent } from "@/sentry";

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
        expect(event.exception.values[0].value).toBe("Application error");
        expect(event.exception.values[0].stacktrace.frames[0]).toEqual({
            filename: "/assets/app.js",
            lineno: 12,
        });
        expect(event.extra).toEqual({
            callsign: "[redacted]",
            nested: { token: "[redacted]" },
        });
        expect(event.logentry).toEqual({ message: "Application error" });
        expect(event.message).toBe("Application error");
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

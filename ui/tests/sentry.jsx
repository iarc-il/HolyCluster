import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { captureException, init } = vi.hoisted(() => ({
    captureException: vi.fn(),
    init: vi.fn(),
}));

vi.mock("@sentry/react", () => ({ captureException, init }));

import RouteErrorBoundary from "@/components/RouteErrorBoundary.jsx";
import { initializeSentry, sanitizeSentryEvent } from "@/sentry";

function ThrowError() {
    throw new Error("sensitive callsign data");
}

describe("Sentry error reporting", () => {
    afterEach(() => {
        cleanup();
        captureException.mockReset();
        init.mockReset();
        vi.restoreAllMocks();
    });

    it("does not initialize without a DSN", () => {
        expect(initializeSentry({ dsn: undefined })).toBe(false);
        expect(init).not.toHaveBeenCalled();
    });

    it("disables tracing and replay when configured", () => {
        expect(
            initializeSentry({
                dsn: "https://public@example.ingest.sentry.io/1",
                environment: "production",
                release: "abcdef",
            }),
        ).toBe(true);

        expect(init).toHaveBeenCalledWith(
            expect.objectContaining({
                dsn: "https://public@example.ingest.sentry.io/1",
                environment: "production",
                release: "abcdef",
                sendDefaultPii: false,
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
            exception: { values: [{ value: "K1ABC failed" }] },
            extra: { callsign: "K1ABC" },
            request: { headers: { authorization: "secret" } },
            user: { email: "operator@example.com" },
        });

        expect(event).not.toHaveProperty("breadcrumbs");
        expect(event).not.toHaveProperty("contexts");
        expect(event).not.toHaveProperty("extra");
        expect(event).not.toHaveProperty("request");
        expect(event).not.toHaveProperty("user");
        expect(event.exception.values[0].value).toBe("Application error");
    });

    it("shows the fallback and reports a rendering failure", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});

        render(
            <RouteErrorBoundary>
                <ThrowError />
            </RouteErrorBoundary>,
        );

        expect(screen.getByRole("alert").textContent).toContain("Something went wrong");
        expect(captureException).toHaveBeenCalledWith(expect.any(Error));
    });
});

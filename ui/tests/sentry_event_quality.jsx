import { prepareSentryEvent, recordBoundaryDiagnostics } from "@/sentry";
import * as Sentry from "@sentry/react";
import { describe, expect, it } from "vitest";

const global_mechanism = "auto.browser.global_handlers.onerror";
const boundary_mechanism = "auto.function.react.error_boundary";
function event(value, frames = [], mechanism = global_mechanism, extra = {}) {
    return {
        ...extra,
        exception: {
            values: [
                {
                    type: "TypeError",
                    value,
                    mechanism: { type: mechanism, handled: false },
                    stacktrace: { frames },
                },
            ],
        },
    };
}
const react = { filename: "/node_modules/react/cjs/react.production.min.js", function: "T" };
const app = { filename: "/assets/index-abc.js", function: "Tabs" };
const gtm = { filename: "https://tracker.example/gtm.js", lineno: 695 };
const secondary = [
    "undefined is not an object (evaluating 'v._result.default')",
    'can\'t access property "default", v._result is undefined',
];

describe("event quality", () => {
    it.each(secondary)("groups a proven lazy secondary without hiding it: %s", message => {
        const result = prepareSentryEvent(event(message, [react], boundary_mechanism));
        expect(result.contexts.diagnostic.category).toBe("react_lazy_secondary");
        expect(result.fingerprint).toEqual(["react_lazy_secondary", "react_boundary"]);
        expect(result.exception.values[0].value).toBe(message);
    });
    it("recognizes the deployed React vendor chunk before server symbolication", () => {
        const frames = [
            { filename: `${location.origin}/assets/vendor-react-abc123.js`, function: "r" },
        ];
        expect(
            prepareSentryEvent(event(secondary[0], frames, boundary_mechanism)).contexts.diagnostic
                .category,
        ).toBe("react_lazy_secondary");
        const external = [
            {
                filename: "https://third-party.example/assets/vendor-react-abc123.js",
                function: "r",
            },
        ];
        expect(
            prepareSentryEvent(event(secondary[0], external, boundary_mechanism)).contexts
                .diagnostic.category,
        ).toBe("unknown");
    });
    it("does not classify arbitrary _result errors or app throws as lazy secondaries", () => {
        for (const input of [
            event(secondary[0], [react]),
            event(secondary[0], [react, app], boundary_mechanism),
            event("_result.default failed", [react], boundary_mechanism),
            event(secondary[0], [], boundary_mechanism),
        ]) {
            expect(prepareSentryEvent(input).contexts.diagnostic.category).not.toBe(
                "react_lazy_secondary",
            );
        }
    });
    it.each([
        "Importing a module script failed.",
        "error loading dynamically imported module: https://example.com/assets/index.js",
        "Failed to fetch dynamically imported module",
    ])("retains canonical module-load reports: %s", message => {
        const result = prepareSentryEvent(event(message));
        expect(result.contexts.diagnostic.category).toBe("module_load");
        expect(result.exception.values[0].value).toBe(message);
    });
    it("filters only proven external Bytespider globalData events", () => {
        const input = event(
            "globalData is not defined",
            [gtm, { filename: "<anonymous>" }],
            global_mechanism,
            { contexts: { browser: { name: "Bytespider" } } },
        );
        input.exception.values[0].type = "ReferenceError";
        expect(prepareSentryEvent(input)).toBeNull();
        const variants = [
            { ...input, contexts: { browser: { name: "Safari" } } },
            { ...input, exception: event("globalData is not defined", [gtm, app]).exception },
            {
                ...input,
                exception: event("globalData is not defined", [{ filename: "/gtm.js" }]).exception,
            },
            {
                ...input,
                exception: event("globalData is not defined", [gtm], boundary_mechanism).exception,
            },
            { ...input, exception: event("another failure", [gtm]).exception },
        ];
        for (const variant of variants) {
            variant.exception.values[0].type = "ReferenceError";
            expect(prepareSentryEvent(variant)).not.toBeNull();
        }
        for (const frames of [
            [],
            [{ function: "global code", lineno: 1 }],
            [gtm, { filename: "unknown.js" }],
            [gtm, { filename: "/assets/index.js" }],
            [{ filename: `${location.origin}/gtm.js` }],
        ]) {
            const variant = event("globalData is not defined", frames, global_mechanism, {
                contexts: input.contexts,
            });
            variant.exception.values[0].type = "ReferenceError";
            expect(prepareSentryEvent(variant)).not.toBeNull();
        }
        const original = new ReferenceError("globalData is not defined");
        original.stack =
            "ReferenceError: globalData is not defined\n at throwSite (https://tracker.example/gtm.js:695:1)";
        expect(prepareSentryEvent(input, { originalException: original })).toBeNull();
        original.stack =
            "ReferenceError: globalData is not defined\n at throwSite (http://localhost:3000/assets/index.js:9:3)";
        expect(prepareSentryEvent(input, { originalException: original })).not.toBeNull();
        original.stack = undefined;
        expect(prepareSentryEvent(input, { originalException: original })).not.toBeNull();
    });
    it("retains filename-less iOS incidents and separates global capture paths", () => {
        for (const message of [
            "Application error (message redacted)",
            "Undefined is not an object",
        ]) {
            const result = prepareSentryEvent(
                event(message, [{ function: "global code", lineno: 1 }], global_mechanism, {
                    contexts: {
                        browser: { name: "Safari", version: "27.0.1" },
                        os: { name: "iOS" },
                    },
                }),
            );
            expect(result.contexts.diagnostic.provenance).toBe("unknown");
            expect(result.fingerprint).toEqual(["{{ default }}", "global_error"]);
        }
    });
    it("sends original boundary errors through the SDK with their evidence intact", async () => {
        const envelopes = [];
        const client = Sentry.init({
            dsn: "https://public@example.com/1",
            defaultIntegrations: false,
            beforeSend: prepareSentryEvent,
            transport: () => ({
                send: envelope => {
                    envelopes.push(envelope);
                    return Promise.resolve({ statusCode: 200 });
                },
                flush: () => Promise.resolve(true),
            }),
        });
        try {
            const original = new TypeError("original boundary failure");
            original.stack =
                "TypeError: original boundary failure\n at throwSite (https://example.com/assets/index.js:9:3)";
            Sentry.withScope(scope => {
                recordBoundaryDiagnostics(
                    scope,
                    original,
                    "\n at Tabs (https://example.com/assets/index.js:20:1)",
                );
                Sentry.captureException(original);
            });
            await Sentry.flush();
            const sent = envelopes
                .flatMap(envelope => envelope[1])
                .find(item => item[0].type === "event")?.[1];
            expect(sent.exception.values.at(-1)).toMatchObject({
                type: "TypeError",
                value: original.message,
                stacktrace: {
                    frames: [expect.objectContaining({ function: "throwSite", lineno: 9 })],
                },
            });
            expect(sent.contexts.diagnostic).toMatchObject({
                capture_path: "react_boundary",
                original_kind: "error",
                original_stack: "present",
                component_stack: "present",
            });
        } finally {
            await client.close();
            Sentry.getCurrentScope().setClient(undefined);
        }
    });
    it("preserves original throw evidence when Tabs is only a component frame", () => {
        const error = new TypeError("original failure");
        error.stack =
            "TypeError: original failure\n at throwSite (https://example.com/assets/index.js:9:3)";
        recordBoundaryDiagnostics(
            null,
            error,
            "\n at Tabs (https://example.com/assets/index.js:20:1)",
        );
        const result = prepareSentryEvent(event(error.message, [app], boundary_mechanism), {
            originalException: error,
        });
        expect(result.contexts.diagnostic.original_frames[0].function).toBe("throwSite");
        expect(result.contexts.diagnostic.component_stack).toBe("present");
        expect(result.contexts.diagnostic.original_stack).toBe("present");
    });
    it("retains caller fingerprints and classifies mixed evidence", () => {
        const result = prepareSentryEvent(
            event(secondary[0], [gtm, app], boundary_mechanism, { fingerprint: ["caller"] }),
        );
        expect(result.fingerprint).toEqual(["caller"]);
        expect(result.contexts.diagnostic.provenance).toBe("mixed");
        const classified = prepareSentryEvent(
            event(secondary[0], [react], boundary_mechanism, { fingerprint: ["caller"] }),
        );
        expect(classified.contexts.diagnostic.category).toBe("react_lazy_secondary");
        expect(classified.fingerprint).toEqual(["caller"]);
    });
});

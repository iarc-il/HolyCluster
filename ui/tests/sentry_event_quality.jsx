import { annotateDiagnosticError, prepareSentryEvent, recordBoundaryDiagnostics } from "@/sentry";
import { toError } from "@/utils/errors.js";
import * as Sentry from "@sentry/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("runtime bridge advisory", () => {
    const message = "Invalid call to runtime.sendMessage(). Tab not found.";
    const rejection = "auto.browser.global_handlers.onunhandledrejection";
    const candidate = () => event(message, [], rejection, { fingerprint: ["caller"] });
    const stackless = () => {
        const error = new Error(message);
        error.stack = undefined;
        return error;
    };
    it("labels exact stackless unhandled evidence without dropping or regrouping it", () => {
        for (const hint of [{}, { originalException: stackless() }]) {
            const input = candidate();
            const result = prepareSentryEvent(input, hint);
            expect(result.contexts.diagnostic.category).toBe("browser_runtime_bridge_candidate");
            expect(result.contexts.diagnostic.provenance).toBe("unknown");
            expect(result.contexts.diagnostic.capture_path).toBe("unhandled_rejection");
            expect(result.fingerprint).toEqual(["caller"]);
            expect(result.exception).toEqual(input.exception);
        }
    });
    it("retains near matches without a bridge classification", () => {
        const variants = [];
        for (const value of [
            message.toLowerCase(),
            `${message} `,
            message.slice(0, -1),
            `Uncaught ${message}`,
            "Invalid call to runtime.sendMessage(). Tab not found!",
        ]) {
            const input = candidate();
            input.exception.values[0].value = value;
            variants.push([input, {}]);
        }
        for (const mechanism of [global_mechanism, boundary_mechanism, "generic"])
            variants.push([event(message, [], mechanism), {}]);
        for (const frames of [[app], [{ function: "unknown" }]])
            variants.push([event(message, frames, rejection), {}]);
        const handled = candidate();
        handled.exception.values[0].mechanism.handled = true;
        variants.push([handled, {}]);
        const absent_handled = candidate();
        absent_handled.exception.values[0].mechanism.handled = undefined;
        variants.push([absent_handled, {}]);
        const additional = candidate();
        additional.exception.values.unshift({ type: "Error", value: "app failure" });
        variants.push([additional, {}]);
        for (const diagnostic of [
            { boundary: true },
            { operation: "websocket_message" },
            { component_stack: "present" },
        ])
            variants.push([{ ...candidate(), contexts: { diagnostic } }, {}]);
        const with_stack = new Error(message);
        with_stack.stack = `Error: ${message}\n at throwSite (http://localhost:3000/assets/index.js:9:3)`;
        variants.push([candidate(), { originalException: with_stack }]);
        const different = stackless();
        different.message = "app failure";
        variants.push([candidate(), { originalException: different }]);
        const cause = stackless();
        cause.cause = new Error("app cause");
        variants.push([candidate(), { originalException: cause }]);
        variants.push([candidate(), { originalException: "app failure" }]);
        variants.push([
            candidate(),
            {
                originalException: annotateDiagnosticError(stackless(), {
                    operation: "app_operation",
                }),
            },
        ]);
        for (const [input, hint] of variants) {
            const result = prepareSentryEvent(input, hint);
            expect(result).not.toBeNull();
            expect(result.contexts.diagnostic.category).not.toBe(
                "browser_runtime_bridge_candidate",
            );
            expect(result.exception.values).toHaveLength(input.exception.values.length);
        }
    });
});

describe("primitive Firefox Windows global OOM", () => {
    const firefox_windows =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0";
    const input = () => {
        const result = event("out of memory", [app]);
        result.exception.values[0].mechanism.synthetic = true;
        return result;
    };
    const hint = { originalException: "out of memory" };
    afterEach(() => vi.restoreAllMocks());
    const ua = value => vi.spyOn(navigator, "userAgent", "get").mockReturnValue(value);
    it("drops only the exact primitive global signal, including synthetic app frames", () => {
        ua(firefox_windows);
        expect(prepareSentryEvent(input(), hint)).toBeNull();
        const stackless = input();
        stackless.exception.values[0].stacktrace.frames = [];
        expect(prepareSentryEvent(stackless, hint)).toBeNull();
    });
    it("retains case, punctuation, whitespace and other OOM variants", () => {
        ua(firefox_windows);
        for (const value of [
            "Out of memory",
            "out of memory.",
            " out of memory",
            "out of memory ",
            "out of memory\n",
            "Out of memory error",
            "Allocation failed - JavaScript heap out of memory",
        ]) {
            const variant = input();
            variant.exception.values[0].value = value;
            expect(prepareSentryEvent(variant, { originalException: value })).not.toBeNull();
            expect(prepareSentryEvent(variant, hint)).not.toBeNull();
            expect(prepareSentryEvent(input(), { originalException: value })).not.toBeNull();
        }
    });
    it("retains Error objects, normalized strings, explicit capture and rejection", () => {
        ua(firefox_windows);
        for (const originalException of [
            new Error("out of memory"),
            toError("out of memory"),
            { message: "out of memory" },
            undefined,
        ])
            expect(prepareSentryEvent(input(), { originalException })).not.toBeNull();
        expect(prepareSentryEvent(input())).not.toBeNull();
        for (const type of [
            "generic",
            "auto.browser.global_handlers.onunhandledrejection",
            boundary_mechanism,
        ]) {
            const variant = input();
            variant.exception.values[0].mechanism.type = type;
            expect(prepareSentryEvent(variant, hint)).not.toBeNull();
        }
        for (const change of [
            { handled: true },
            { synthetic: false },
            { synthetic: undefined },
            { handled: undefined },
        ]) {
            const variant = input();
            Object.assign(variant.exception.values[0].mechanism, change);
            expect(prepareSentryEvent(variant, hint)).not.toBeNull();
        }
    });
    it("retains contradictory messages, boundary, cause and app operation evidence", () => {
        ua(firefox_windows);
        const variants = [
            { ...input(), message: "app failure" },
            ...[
                { boundary: true },
                { operation: "react_boundary" },
                { operation: "websocket_message" },
                { original_stack: "present" },
                { javascript_stack_origin: "original" },
                { original_frames: [app] },
                { component_stack: "present" },
                { original_kind: "error" },
                { original_value: "different" },
            ].map(diagnostic => ({ ...input(), contexts: { diagnostic } })),
        ];
        const cause = input();
        cause.exception.values.unshift({ type: "Error", value: "app cause" });
        variants.push(cause);
        for (const variant of variants) expect(prepareSentryEvent(variant, hint)).not.toBeNull();
        const annotated = annotateDiagnosticError("out of memory", { operation: "app_operation" });
        expect(prepareSentryEvent(input(), { originalException: annotated })).not.toBeNull();
    });
    it("retains contradictory client browser and OS contexts", () => {
        ua(firefox_windows);
        for (const contexts of [
            { browser: { name: "Chrome" } },
            { os: { name: "Linux" } },
            { device: { type: "mobile" } },
            { device: { type: "tablet" } },
        ]) {
            expect(prepareSentryEvent({ ...input(), contexts }, hint)).not.toBeNull();
        }
    });
    it("requires desktop Firefox on Windows from client evidence", () => {
        for (const value of [
            firefox_windows.replace("Windows NT 10.0; Win64; x64", "X11; Linux x86_64"),
            firefox_windows.replace(
                "Windows NT 10.0; Win64; x64",
                "Macintosh; Intel Mac OS X 10.15",
            ),
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Android 14; Mobile; rv:147.0) Gecko/147.0 Firefox/147.0",
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 FxiOS/147.0 Mobile/15E148 Safari/605.1.15",
            `${firefox_windows} Mobile`,
            "",
        ]) {
            ua(value);
            expect(prepareSentryEvent(input(), hint)).not.toBeNull();
            expect(
                prepareSentryEvent(
                    {
                        ...input(),
                        contexts: { browser: { name: "Firefox" }, os: { name: "Windows" } },
                    },
                    hint,
                ),
            ).not.toBeNull();
            vi.restoreAllMocks();
        }
    });
});

describe("event quality", () => {
    it.each(secondary)("groups a proven lazy secondary without hiding it: %s", message => {
        const result = prepareSentryEvent(event(message, [react], boundary_mechanism));
        expect(result.contexts.diagnostic.category).toBe("react_lazy_secondary");
        expect(result.fingerprint).toEqual(["react_lazy_secondary", "react_boundary"]);
        expect(result.exception.values[0].value).toBe(message);
    });
    it("recognizes the deployed React vendor chunk before server symbolication", () => {
        for (const filename of [
            "/assets/vendor-react-abc123.js",
            `${location.origin}/assets/vendor-react-abc123.js`,
        ]) {
            const frames = [{ filename, function: "r" }];
            expect(
                prepareSentryEvent(event(secondary[0], frames, boundary_mechanism)).contexts
                    .diagnostic.category,
            ).toBe("react_lazy_secondary");
        }
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
            event(
                secondary[0],
                [{ filename: "/assets/vendor-other-abc123.js", function: "T" }],
                boundary_mechanism,
            ),
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
    it("retains the mixed-source Bytespider incident without claiming external provenance", () => {
        const input = event(
            "globalData is not defined",
            [app, gtm, { filename: "<anonymous>", lineno: 1 }],
            global_mechanism,
            { contexts: { browser: { name: "Bytespider" } } },
        );
        input.exception.values[0].type = "ReferenceError";
        const result = prepareSentryEvent(input);
        expect(result.contexts.diagnostic.provenance).toBe("mixed");
        expect(result.contexts.diagnostic.script_origins).toEqual([
            "same_origin_asset_path",
            "cross_origin_url",
            "inline_or_unrecognized",
        ]);
        expect(result.exception).toEqual(input.exception);
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
    it("retains complete thrown strings in diagnostic contexts", () => {
        const original = "diagnostic detail ".repeat(100);
        const result = prepareSentryEvent(event(original), { originalException: original });
        expect(result.contexts.diagnostic.original_value).toBe(original);
    });
    it("does not copy private thrown-object fields into diagnostic contexts", () => {
        const original = { token: "private-object-token", profile: { email: "private-email" } };
        const input = event("[object Object]", [], boundary_mechanism);
        expect(
            JSON.stringify(prepareSentryEvent(input, { originalException: original })),
        ).not.toMatch(/private-object-token|private-email/);
        let processor;
        recordBoundaryDiagnostics(
            {
                addEventProcessor: callback => {
                    processor = callback;
                },
            },
            original,
            "\n at Tabs",
        );
        const processed = processor(input);
        expect(
            JSON.stringify(prepareSentryEvent(processed, { originalException: original })),
        ).not.toMatch(/private-object-token|private-email/);
        const error = new TypeError("failure");
        error.private_data = original;
        expect(
            JSON.stringify(prepareSentryEvent(event(error.message), { originalException: error })),
        ).not.toMatch(/private-object-token|private-email/);
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

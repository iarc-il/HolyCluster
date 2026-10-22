import { readFile } from "node:fs/promises";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { expect, test } from "@playwright/test";

function assetPath(filename) {
    if (!filename) return null;
    try {
        const path = new URL(filename, "http://127.0.0.1").pathname;
        return path.startsWith("/assets/") ? path : null;
    } catch {
        return null;
    }
}

async function mappedSources(event) {
    const sources = [];
    for (const value of event.exception.values) {
        for (const frame of value.stacktrace?.frames ?? []) {
            const path = assetPath(frame.filename);
            if (!path || !frame.lineno || !frame.colno) continue;
            const map = JSON.parse(await readFile(`dist/diagnostics${path}.map`, "utf8"));
            const original = originalPositionFor(new TraceMap(map), {
                line: frame.lineno,
                column: frame.colno - 1,
            });
            if (original.source && original.line) {
                const source = map.sourcesContent[map.sources.indexOf(original.source)];
                sources.push(source?.split("\n")[original.line - 1]);
            }
        }
    }
    return sources;
}

async function capture(page, scenario) {
    const events = [];
    await page.routeWebSocket("**/*", socket => {
        if (new URL(socket.url()).pathname !== "/ws") return;
        socket.onMessage(() => {
            socket.send(
                JSON.stringify({
                    type: "radio",
                    event: "status",
                    status: "unavailable",
                    version: 1,
                }),
            );
            setTimeout(
                () =>
                    socket.send(
                        JSON.stringify({
                            type: scenario === "websocket_update" ? "update" : "radio",
                            event: "diagnostic_failure",
                            secret: "payload",
                        }),
                    ),
                100,
            );
        });
    });
    await page.route("**/api/1/envelope/**", async route => {
        const lines = route.request().postData().split("\n");
        for (let index = 1; index + 1 < lines.length; index += 2) {
            if (JSON.parse(lines[index]).type === "event")
                events.push(JSON.parse(lines[index + 1]));
        }
        await route.fulfill({ status: 200, body: "{}" });
    });
    await page.goto("/e2e/diagnostics/index.html");
    await page.waitForFunction(() => window.diagnostics_ready);
    await page.evaluate(scenario => window.run_diagnostic(scenario), scenario);
    await expect.poll(() => events.length).toBeGreaterThan(0);
    const event = events.find(event => event.contexts?.diagnostic);
    expect(event.release).toBe("diagnostic-browser-test");
    expect(JSON.stringify(event).length).toBeLessThan(16000);
    return event;
}

test("reports the original failure through the production React boundary and SDK", async ({
    page,
}) => {
    const event = await capture(page, "boundary");
    expect(event.contexts.diagnostic).toMatchObject({
        capture_path: "react_boundary",
        original_kind: "error",
        original_stack: "present",
    });
    expect(event.fingerprint).toEqual(["{{ default }}", "react_boundary"]);
    expect(
        event.exception.values.some(
            value =>
                value.type === "TypeError" &&
                value.stacktrace?.frames?.some(
                    frame => assetPath(frame.filename) && frame.lineno > 0 && frame.colno > 0,
                ),
        ),
    ).toBe(true);
    expect(
        event.exception.values.some(
            value =>
                value.type === "React ErrorBoundary TypeError" &&
                value.stacktrace?.frames?.length > 0,
        ),
    ).toBe(true);
    expect((await mappedSources(event)).join("\n")).toContain("return missing.secret;");
    await expect(page.getByRole("alert")).toBeVisible();
});

test("reports primitive boundary failures with separate synthetic and component stacks", async ({
    page,
}) => {
    const event = await capture(page, "boundary_primitive");
    expect(event.contexts.diagnostic).toMatchObject({
        capture_path: "react_boundary",
        original_kind: "string",
        original_stack: "absent",
        javascript_stack_origin: "synthetic_capture",
        component_stack: "present",
    });
    expect(event.fingerprint).toEqual(["{{ default }}", "react_boundary"]);
    expect(event.exception.values).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                type: "React ErrorBoundary NonErrorThrown",
                stacktrace: { frames: expect.any(Array) },
            }),
            expect.objectContaining({
                type: "NonErrorThrown",
                value: "diagnostic primitive boundary failure",
                stacktrace: { frames: expect.any(Array) },
            }),
        ]),
    );
    expect(JSON.stringify(event)).not.toContain("Application error (message redacted)");
    await expect(page.getByRole("alert")).toBeVisible();
});

test("preserves complete boundary cause chains", async ({ page }) => {
    const event = await capture(page, "boundary_cause");
    expect(event.contexts.diagnostic).toMatchObject({
        capture_path: "react_boundary",
        original_kind: "error",
        javascript_stack_origin: "original",
        component_stack: "present",
    });
    expect(event.exception.values).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ type: "Error", value: "diagnostic boundary cause" }),
            expect.objectContaining({
                type: "TypeError",
                value: "diagnostic boundary failure",
            }),
        ]),
    );
    for (const value of event.exception.values) {
        expect(value.stacktrace?.frames?.length).toBeGreaterThan(0);
    }
});

test("retains WebSocket operation evidence through a real subscriber and boundary", async ({
    page,
}) => {
    const event = await capture(page, "websocket");
    expect(event.contexts.diagnostic).toMatchObject({
        operation: "websocket_message",
        stage: "subscriber",
        message_type: "radio",
        transport: "unified",
        capture_path: "react_boundary",
        original_stack: "present",
    });
    expect((await mappedSources(event)).join("\n")).toContain("return message.missing.secret;");
    await expect(page.getByRole("alert")).toBeVisible();
});

test("reports direct update subscriber failures without changing callback behavior", async ({
    page,
}) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error));
    const event = await capture(page, "websocket_update");
    expect(event.contexts.diagnostic).toMatchObject({
        operation: "websocket_message",
        stage: "subscriber",
        message_type: "update",
        transport: "unified",
        original_stack: "present",
    });
    expect(errors).toEqual([]);
    await expect(page.getByRole("alert")).toHaveCount(0);
});

test("uses network history after a real upgrade abort without unhandled errors", async ({
    page,
}) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
        window.cache_opens = 0;
        window.cache_aborts = 0;
        window.cache_rejections = [];
        window.addEventListener("unhandledrejection", event => {
            window.cache_rejections.push(event.reason?.name);
        });
        const open = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function (...args) {
            const request = open.apply(this, args);
            if (args[0] === "holycluster_propagation_cache") {
                window.cache_opens++;
                // Register after idb's synchronous listener so schema creation
                // succeeds before the controlled native transaction abort.
                queueMicrotask(() =>
                    request.addEventListener("upgradeneeded", () => {
                        window.cache_aborts++;
                        request.transaction.abort();
                    }),
                );
            }
            return request;
        };
    });
    await page.goto("/e2e/diagnostics/index.html");
    await page.waitForFunction(() => window.diagnostics_ready);
    const result = await page.evaluate(() => window.run_diagnostic("cache_abort"));
    expect(result).toMatchObject({ is_complete: true, requests: 1, updates: 1, handlers: 0 });
    expect(result.propagation_history.metrics.sfi).toHaveLength(1);
    expect(result.propagation_history.metrics.sfi[0].value).toBe(123);
    expect(
        await page.evaluate(() => ({ opens: window.cache_opens, aborts: window.cache_aborts })),
    ).toEqual({ opens: 1, aborts: 1 });
    // Cross an event-loop boundary so rejected upgrade completion promises
    // have time to dispatch unhandledrejection.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    expect(await page.evaluate(() => window.cache_rejections)).toEqual([]);
    expect(errors).toEqual([]);
});

test("retains native version rejection at the open boundary", async ({ page }) => {
    const event = await capture(page, "version");
    expect(event.contexts.diagnostic).toMatchObject({
        operation: "cache_hydration",
        stage: "open",
        native_name: "VersionError",
        requested_version: 1,
    });
    expect(event.contexts.diagnostic).not.toHaveProperty("observed_version");
});

for (const [scenario, kind, stack] of [
    ["cross_realm", "error", "present"],
    ["primitive", "string", "absent"],
    ["stackless", "error", "absent"],
]) {
    test(`reports a real ${scenario} unhandled rejection`, async ({ page }) => {
        const event = await capture(page, scenario);
        expect(event.contexts.diagnostic).toMatchObject({
            capture_path: "unhandled_rejection",
            original_kind: kind,
            original_stack: stack,
        });
        expect(event.fingerprint).toEqual(["{{ default }}", "unhandled_rejection"]);
    });
}

for (const [scenario, stage, name, present] of [
    ["missing_store", "transaction", "NotFoundError", false],
    ["closed_database", "transaction", "InvalidStateError", true],
    ["subscriber", "notify", undefined, true],
]) {
    test(`distinguishes real IndexedDB ${scenario} failures`, async ({ page }) => {
        const event = await capture(page, scenario);
        expect(event.contexts.diagnostic).toMatchObject({
            operation: "cache_hydration",
            stage,
            requested_version: 1,
            observed_version: 1,
            expected_store_present: present,
        });
        if (name) expect(event.contexts.diagnostic.native_name).toBe(name);
    });
}

import { readFile } from "node:fs/promises";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { expect, test } from "@playwright/test";

async function mappedSources(event) {
    const sources = [];
    for (const value of event.exception.values) {
        for (const frame of value.stacktrace?.frames ?? []) {
            if (!frame.filename?.startsWith("/assets/") || !frame.lineno || !frame.colno) continue;
            const map = JSON.parse(await readFile(`dist/diagnostics${frame.filename}.map`, "utf8"));
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
    expect(JSON.stringify(event)).not.toContain("secret");
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
                    frame =>
                        frame.filename?.startsWith("/assets/") &&
                        frame.lineno > 0 &&
                        frame.colno > 0,
                ),
        ),
    ).toBe(true);
    expect((await mappedSources(event)).join("\n")).toContain("return missing.secret;");
    await expect(page.getByRole("alert")).toBeVisible();
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

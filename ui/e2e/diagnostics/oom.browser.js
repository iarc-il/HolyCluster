import { expect, test } from "../fixtures/browser.js";

test.use({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0",
});

test("filters the primitive global OOM but delivers a native Error through the real SDK", async ({
    page,
}) => {
    const events = [];
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
    await page.evaluate(() => window.run_diagnostic("global_oom"));
    expect(events).toHaveLength(1);
    expect(events[0].contexts.diagnostic).toMatchObject({
        capture_path: "global_error",
        original_kind: "error",
        original_stack: "present",
        javascript_stack_origin: "original",
    });
    expect(events[0].exception.values[0].value).toBe("out of memory");
    expect(events[0].exception.values[0].mechanism).toMatchObject({
        type: "auto.browser.global_handlers.onerror",
        handled: false,
    });
});

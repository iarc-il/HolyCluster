import { expect, testWithBrowserErrors } from "../fixtures/browser.js";

for (const source of ["same_origin", "cross_origin"]) {
    testWithBrowserErrors(
        `retains per-frame evidence for a real ${source} script failure`,
        [/^pageerror: secret$/],
        async ({ page }) => {
            const events = [];
            const page_errors = [];
            page.on("pageerror", error => page_errors.push(error));
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
            const origin =
                source === "same_origin" ? "http://127.0.0.1:5187" : "https://external.invalid";
            const url = `${origin}/private/secret.js?secret`;
            await page.route(url, route =>
                route.fulfill({
                    contentType: "application/javascript",
                    headers: { "Access-Control-Allow-Origin": "*" },
                    body: `document.addEventListener("diagnostic-script-failure", function sendDataToNative() {
                throw new ReferenceError("secret");
            });`,
                }),
            );
            await page.addScriptTag({ url, type: "module" });
            await page.evaluate(() =>
                document.dispatchEvent(new Event("diagnostic-script-failure")),
            );
            await expect.poll(() => events.length).toBe(1);
            const event = events[0];
            expect(event.exception.values).toHaveLength(1);
            expect(event.exception.values[0].mechanism).toMatchObject({
                type: "auto.browser.browserapierrors.addEventListener",
                handled: false,
            });
            const frames = event.exception.values[0].stacktrace.frames;
            const index = frames.findIndex(frame => frame.function?.endsWith("sendDataToNative"));
            expect(index).toBeGreaterThanOrEqual(0);
            const frame_url = new URL(frames[index].filename);
            const expected_url = new URL(url);
            expect(`${frame_url.origin}${frame_url.pathname}`).toBe(
                `${expected_url.origin}${expected_url.pathname}`,
            );
            expect(event.contexts.diagnostic.frame_sources).toContainEqual({
                exception_index: 0,
                frame_index: index,
                source_class: source === "same_origin" ? "same_origin_url" : "cross_origin_url",
            });
            expect(event.fingerprint).toBeUndefined();
            expect(JSON.stringify(event)).toMatch(/private\/|secret/);
            if (source === "cross_origin")
                expect(JSON.stringify(event)).toContain("external.invalid");
            expect(JSON.stringify(event).length).toBeLessThan(16000);
            await expect.poll(() => page_errors.length).toBe(1);
        },
    );
}

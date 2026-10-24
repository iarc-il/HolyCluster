import { readFile } from "node:fs/promises";
import { expect, test, testWithBrowserErrors } from "../fixtures/browser.js";

const html = await readFile(new URL("../../dist/integrity/index.html", import.meta.url), "utf8");
const entry = html.match(/<script type="module"[^>]*src="([^"]+)"/)[1];
const newer = html.replaceAll(entry, "/assets/new-release.js");

test.beforeEach(async ({ page }) => {
    await page.clock.install();
    await page.addInitScript(() => localStorage.setItem("first_launch", "false"));
    await page.route(/https:\/\//, route =>
        route.fulfill({
            status: 200,
            contentType:
                route.request().resourceType() === "stylesheet"
                    ? "text/css"
                    : "application/javascript",
            body: "",
        }),
    );
    await page.routeWebSocket(/\/(ws|radio|spots_ws|submit_spot)$/, () => {});
    for (const endpoint of ["propagation", "dxpeditions", "history", "voacap"]) {
        await page.route(`**/${endpoint}*`, route =>
            route.fulfill({
                contentType: "application/json",
                body: endpoint === "propagation" ? "null" : "[]",
            }),
        );
    }
});

for (const [state, path] of [
    ["new", "/"],
    ["same", "/"],
    ["offline", "/"],
    ["new", "/addons"],
    ["new", "/omnirig-error"],
]) {
    testWithBrowserErrors(
        `checks the ${state} build on ${path} without automatic reload`,
        state === "offline"
            ? [/^console: Failed to load resource: (?:net::ERR_FAILED|Load failed)$/]
            : [],
        async ({ page }) => {
            let documents = 0;
            let probes = 0;
            await page.route(`**${path}`, route => {
                if (route.request().resourceType() === "document") {
                    documents++;
                    return route.fulfill({ contentType: "text/html", body: html });
                }
                probes++;
                return state === "offline"
                    ? route.abort()
                    : route.fulfill({
                          contentType: "text/html",
                          body: state === "new" ? newer : html,
                      });
            });
            await page.goto(path);
            if (path === "/")
                await expect(page.locator('[data-tour="about-trigger"]')).toBeAttached();
            await expect.poll(() => probes).toBe(1);
            const update = page.getByRole("button", { name: "Reload to update" });
            if (state === "new") await expect(update).toBeVisible();
            else await expect(update).toHaveCount(0);
            await page.clock.fastForward(300000);
            await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
            if (state === "new") expect(probes).toBe(1);
            else await expect.poll(() => probes).toBeGreaterThanOrEqual(2);
            expect(documents).toBe(1);
            if (state === "new") {
                await expect(update).toHaveCount(1);
                await update.click();
                await expect.poll(() => documents).toBe(2);
            } else {
                await expect(update).toHaveCount(0);
            }
        },
    );
}

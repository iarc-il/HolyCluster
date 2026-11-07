import { readFile } from "node:fs/promises";
import { expect, test, testWithBrowserErrors } from "../fixtures/browser.js";

const html = await readFile(new URL("../../dist/integrity/index.html", import.meta.url), "utf8");
const entry = html.match(/<script type="module"[^>]*src="([^"]+)"/)[1];
const newer = html.replaceAll(entry, "/assets/new-release.js");

async function prepare(page) {
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
}

test.beforeEach(async ({ page }) => prepare(page));

for (const path of ["/", "/addons", "/omnirig-error"]) {
    testWithBrowserErrors(
        `reloads ${path} after one hour of inactivity when a new build is available`,
        [],
        async ({ page }) => {
            let documents = 0;
            let probes = 0;
            await page.route(`**${path}`, route => {
                if (route.request().resourceType() === "document") {
                    documents++;
                    return route.fulfill({ contentType: "text/html", body: html });
                }
                probes++;
                return route.fulfill({ contentType: "text/html", body: newer });
            });

            await page.goto(path);
            if (path === "/")
                await expect(page.locator('[data-tour="about-trigger"]')).toBeAttached();
            await expect.poll(() => probes).toBe(1);
            await expect(page.getByRole("button", { name: "Reload" })).toHaveCount(0);

            await page.clock.fastForward(59 * 60 * 1000);
            expect(documents).toBe(1);
            expect(probes).toBe(1);

            await page.clock.fastForward(2 * 60 * 1000);
            await expect.poll(() => documents).toBe(2);
            await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
        },
    );
}

for (const [state, failure] of [
    ["same", null],
    ["offline", /^console: Failed to load resource: (?:net::ERR_FAILED|Load failed)$/],
]) {
    testWithBrowserErrors(
        `keeps the current build when the probe is ${state}`,
        failure ? [failure] : [],
        async ({ page }) => {
            let documents = 0;
            let probes = 0;
            await page.route("**/", route => {
                if (route.request().resourceType() === "document") {
                    documents++;
                    return route.fulfill({ contentType: "text/html", body: html });
                }
                probes++;
                return state === "offline"
                    ? route.abort()
                    : route.fulfill({ contentType: "text/html", body: html });
            });

            await page.goto("/");
            await expect.poll(() => probes).toBe(1);
            await page.clock.fastForward(61 * 60 * 1000);
            await expect.poll(() => probes).toBe(2);
            expect(documents).toBe(1);
            await expect(page.getByRole("button", { name: "Reload" })).toHaveCount(0);
        },
    );
}

test("trusted interaction postpones automatic refresh", async ({ page }) => {
    let documents = 0;
    await page.route("**/", route => {
        if (route.request().resourceType() === "document") {
            documents++;
            return route.fulfill({ contentType: "text/html", body: html });
        }
        return route.fulfill({ contentType: "text/html", body: newer });
    });

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Reload" })).toHaveCount(0);
    await page.clock.fastForward(59 * 60 * 1000);
    await page.mouse.click(2, 2);
    await page.clock.fastForward(2 * 60 * 1000);
    expect(documents).toBe(1);

    await page.clock.fastForward(60 * 60 * 1000);
    await expect.poll(() => documents).toBe(2);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
});

test("waits another hour after an open modal closes", async ({ page }) => {
    let documents = 0;
    await page.route("**/", route => {
        if (route.request().resourceType() === "document") {
            documents++;
            return route.fulfill({ contentType: "text/html", body: html });
        }
        return route.fulfill({ contentType: "text/html", body: newer });
    });

    await page.goto("/");
    await page.locator('[data-tour="about-trigger"]').evaluate(element => element.click());
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.clock.fastForward(61 * 60 * 1000);
    expect(documents).toBe(1);

    await page.locator('[data-tour="modal-close-button"]').click();
    await page.clock.fastForward(59 * 60 * 1000);
    expect(documents).toBe(1);
    await page.clock.fastForward(2 * 60 * 1000);
    await expect.poll(() => documents).toBe(2);
});

test("shows recovery after a target mismatch", async ({ page }) => {
    await page.addInitScript(
        ({ entry }) =>
            sessionStorage.setItem(
                "holycluster_ui_navigation",
                JSON.stringify({ source_entry: entry, target_entry: "/assets/new-release.js" }),
            ),
        { entry },
    );
    await page.route("**/", route => route.fulfill({ contentType: "text/html", body: html }));

    await page.goto("/");
    await expect(page.getByText("Part of the UI could not be loaded.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
});

test("classifies a newer loaded entry without showing a mismatch", async ({ page }) => {
    await page.addInitScript(() =>
        sessionStorage.setItem(
            "holycluster_ui_navigation",
            JSON.stringify({
                source_entry: "/assets/obsolete.js",
                target_entry: "/assets/older-target.js",
            }),
        ),
    );
    await page.route("**/", route => route.fulfill({ contentType: "text/html", body: html }));

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Reload" })).toHaveCount(0);
});

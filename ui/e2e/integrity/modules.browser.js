import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const html = await readFile(new URL("../../dist/index.html", import.meta.url), "utf8");
const entry = html.match(/<script type="module"[^>]*src="([^"]+)"/)[1];
const stale_html = html.replaceAll(entry, "/assets/obsolete.js");

test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.addInitScript(() => localStorage.setItem("first_launch", "false"));
    await page.route(/https:\/\//, route => route.abort());
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

async function serve(page, { fresh = html, storage = true } = {}) {
    let documents = 0;
    let probes = 0;
    if (!storage) {
        await page.addInitScript(() => {
            Object.defineProperty(window, "sessionStorage", {
                get() {
                    throw new Error("Storage blocked");
                },
            });
        });
    }
    await page.route("**/assets/obsolete.js", route => route.fulfill({ status: 404, body: "" }));
    await page.route("**/", route => {
        if (route.request().resourceType() === "document") {
            documents++;
            return route.fulfill({
                contentType: "text/html",
                body: documents === 1 ? stale_html : html,
            });
        }
        probes++;
        return fresh === null
            ? route.abort()
            : route.fulfill({ contentType: "text/html", body: fresh });
    });
    return { documents: () => documents, probes: () => probes };
}

test("recovers an obsolete initial module before the app can start", async ({ page }) => {
    const counts = await serve(page);
    await page.goto("/");
    await expect.poll(counts.documents).toBe(2);
    await expect(page.locator('[data-tour="about-trigger"]')).toBeAttached();
    expect(counts.probes()).toBe(1);
});

for (const [name, options] of [
    ["same broken build", { fresh: stale_html }],
    ["offline probe", { fresh: null }],
    ["unavailable session storage", { storage: false }],
]) {
    test(`does not reload with ${name}`, async ({ page }) => {
        const counts = await serve(page, options);
        await page.goto("/");
        await page.waitForTimeout(700);
        expect(counts.documents()).toBe(1);
        expect(counts.probes()).toBe(options.storage === false ? 0 : 1);
    });
}

test("recovers a failed lazy module once and stops on a broken target build", async ({ page }) => {
    let documents = 0;
    let probes = 0;
    const obsolete_metadata = stale_html.replace(
        /(<script type="module"[^>]*src=")[^"]+/,
        `$1${entry}`,
    );
    await page.route("**/assets/Addons-*.js", route => route.fulfill({ status: 404, body: "" }));
    await page.route("**/addons", route => {
        const document = route.request().resourceType() === "document";
        if (document) documents++;
        else probes++;
        return route.fulfill({
            contentType: "text/html",
            body: document && documents === 1 ? obsolete_metadata : html,
        });
    });
    await page.goto("/addons");
    await expect.poll(() => documents).toBe(2);
    await expect.poll(() => probes).toBe(2);
    await page.waitForTimeout(700);
    expect(documents).toBe(2);
});

test("runs release-note JSX in the production module graph", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");
    await page.locator('[data-tour="about-trigger"]').click();
    await page.locator('[data-tour="about-tab-release-notes"]').click();
    await expect(page.getByText("The winner is")).toBeVisible();
    expect(errors).toEqual([]);
});

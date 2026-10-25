import { expect, test } from "./fixtures/browser.js";

test.use({ viewport: { width: 1920, height: 1080 } });

async function mockUpdates(page) {
    await page.addInitScript(() => {
        localStorage.setItem("first_launch", "false");
        localStorage.setItem("active_view", "0");
    });
    const mock = { state: "idle", checks: 0, installs: 0, session: null, websocket: null };
    await page.route(/\/api\/update(?:\/.*)?$/, route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/check")) {
            mock.checks += 1;
            mock.state = "available";
        }
        if (path.endsWith("/defer")) mock.state = "deferred";
        if (path.endsWith("/install")) {
            mock.installs += 1;
            mock.state = "downloading";
            mock.session = {
                id: "translated-update",
                started: Date.now(),
                expected_version: "1.3.2",
                phase: "downloading",
                total: 100,
                downloaded: 20,
            };
        }
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                state: mock.state,
                available_version: mock.state === "idle" ? null : "1.3.2",
                session: mock.session,
            }),
        });
    });
    await page.routeWebSocket("**/ws", websocket => {
        mock.websocket = websocket;
        const identity = JSON.stringify({
            version: 1,
            type: "radio",
            event: "status",
            status: "connected",
            catserver_version: "catserver-v1.3.1",
        });
        websocket.send(identity);
        websocket.onMessage(() => websocket.send(identity));
    });
    return mock;
}

test("update badge and consent dialog share available and deferred state", async ({ page }) => {
    const mock = await mockUpdates(page);
    await page.goto("/");
    const badge = page.locator('[data-tour="cat-download-link"]');
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Version 1.3.2 is ready to install.");
    await expect(badge).toContainText("!");
    expect(mock.checks).toBe(1);
    expect(mock.installs).toBe(0);
    await dialog.getByRole("button", { name: "Later" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => mock.state).toBe("deferred");
    await expect(badge).toContainText("!");
    await badge.getByRole("link").click();
    await expect(dialog).toContainText("Version 1.3.2 is ready to install.");
    await expect(dialog.getByRole("button", { name: "Update", exact: true })).toBeVisible();
    expect(mock.checks).toBe(1);
    expect(mock.installs).toBe(0);
    await dialog.getByRole("button", { name: "Later" }).click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await expect(badge).toContainText("!");
    await expect(dialog).toHaveCount(0);
    expect(mock.checks).toBe(1);
});

test("translated update controls survive progress, failure, dismissal and reopen", async ({
    page,
}) => {
    const mock = await mockUpdates(page);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Version 1.3.2 is ready to install.");
    await page.evaluate(() => {
        window.translated_nodes = 0;
        const translate = () => {
            for (const element of document.querySelectorAll(
                '[role="dialog"] h2, [role="dialog"] button',
            )) {
                for (const node of [...element.childNodes]) {
                    if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
                    const outer = document.createElement("font");
                    const inner = document.createElement("font");
                    inner.textContent = `Translated ${node.textContent}`;
                    outer.append(inner);
                    element.replaceChild(outer, node);
                    window.translated_nodes += 1;
                }
            }
        };
        window.translation_observer = new MutationObserver(translate);
        window.translation_observer.observe(document.body, { childList: true, subtree: true });
        translate();
    });
    await expect(dialog.locator("h2 > font > font").first()).toBeVisible();
    await expect(dialog.locator("h2")).toContainText("available");
    await dialog.getByRole("button", { name: "Translated Update", exact: true }).click();
    await expect(page.getByText("Something went wrong", { exact: false })).toHaveCount(0);
    await expect(dialog.getByRole("status")).toContainText("Downloading");
    mock.session = { ...mock.session, phase: "failed", diagnostic: "Test download failed" };
    mock.websocket.send(
        JSON.stringify({ version: 1, type: "updater", event: "restarting", session: mock.session }),
    );
    await expect(dialog).toContainText("Test download failed");
    mock.state = "deferred";
    mock.session = null;
    await dialog.getByRole("button", { name: "Translated Dismiss", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.locator('[data-tour="cat-download-link"]').getByRole("link").click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("h2 > font > font")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Translated Later", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => window.translated_nodes)).toBeGreaterThan(4);
    await expect(page.getByText("Something went wrong", { exact: false })).toHaveCount(0);
    expect(errors).toEqual([]);
});

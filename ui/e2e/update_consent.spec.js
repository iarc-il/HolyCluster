import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1920, height: 1080 } });

test("update badge and consent dialog share available and deferred state", async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem("first_launch", "false");
        localStorage.setItem("active_view", "0");
    });
    let state = "idle";
    let checks = 0;
    let installs = 0;
    await page.route(/\/api\/update(?:\/.*)?$/, route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/check")) {
            checks += 1;
            state = "available";
        }
        if (path.endsWith("/defer")) state = "deferred";
        if (path.endsWith("/install")) installs += 1;
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                state,
                available_version: state === "idle" ? null : "1.3.2",
                session: null,
            }),
        });
    });
    await page.routeWebSocket("**/ws", websocket => {
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
    await page.goto("/");
    const badge = page.locator('[data-tour="cat-download-link"]');
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Version 1.3.2 is ready to install.");
    await expect(badge).toContainText("!");
    expect(checks).toBe(1);
    expect(installs).toBe(0);
    await dialog.getByRole("button", { name: "Later" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => state).toBe("deferred");
    await expect(badge).toContainText("!");
    await badge.getByRole("link").click();
    await expect(dialog).toContainText("Version 1.3.2 is ready to install.");
    await expect(dialog.getByRole("button", { name: "Update", exact: true })).toBeVisible();
    expect(checks).toBe(1);
    expect(installs).toBe(0);
    await dialog.getByRole("button", { name: "Later" }).click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await expect(badge).toContainText("!");
    await expect(dialog).toHaveCount(0);
    expect(checks).toBe(1);
});

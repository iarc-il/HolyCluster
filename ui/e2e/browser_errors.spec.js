import { expect, test } from "./fixtures/browser.js";

test("ordinary E2E servers have no telemetry DSN", async ({ page }) => {
    await page.goto("/");
    expect(
        await page.evaluate(async () => {
            const { initializeSentry } = await import("/src/sentry.js");
            return initializeSentry();
        }),
    ).toBe(false);
});

test("detects an uncaught send to a closed Playwright WebSocket", async ({ page }) => {
    let socket;
    await page.routeWebSocket("**/controlled-socket", route => {
        socket = route;
    });
    await page.goto("/");
    await page.evaluate(() => {
        window.controlled_socket = new WebSocket(`ws://${location.host}/controlled-socket`);
    });
    await expect.poll(() => Boolean(socket)).toBe(true);
    await page.evaluate(() => {
        window.controlled_socket.close();
    });
    await expect.poll(() => page.evaluate(() => window.controlled_socket.readyState)).toBe(3);
    const error = page.waitForEvent("pageerror");
    await page.evaluate(() => {
        setTimeout(() => window.controlled_socket.send("late reply"), 0);
    });
    expect((await error).message).toMatch(/WebSocket is already in CLOSING or CLOSED state/);
    test.fail(true, "The browser error guard must reject the closed mock send during cleanup");
});

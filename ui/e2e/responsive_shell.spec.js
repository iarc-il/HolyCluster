import { expect, test } from "./fixtures/tour.js";

for (const width of [768, 1280, 1440, 1535]) {
    test(`compact cockpit at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        const filters = page.getByRole("button", { name: "Open Filters", exact: true });
        const tools = page.getByRole("button", { name: "Open Tools", exact: true });
        const left = page.locator('[data-tour="left-column"]');
        const right = page.locator('[data-tour="side-panel"]');
        const scrim = page.getByRole("button", { name: /^Close (Filters|Tools) overlay$/ });
        await expect(filters).toBeVisible();
        await expect(tools).toBeVisible();
        await expect(left).toBeHidden();
        await expect(right).toBeHidden();
        await expect(scrim).toBeHidden();
        await expect(page.locator('[data-tour="map-panel"]')).toBeVisible();
        await expect(page.locator('[data-tour="table-panel"]')).toBeVisible();

        await filters.click();
        await expect(left).toBeVisible();
        await expect(right).toBeHidden();
        await expect(scrim).toBeVisible();
        await expect(page.locator('[data-tour="top-bar-left-menu"] button')).toHaveAttribute(
            "aria-expanded",
            "true",
        );
        await expect(page.locator('[data-tour="top-bar-left-menu"] button')).toHaveAccessibleName(
            "Close Filters",
        );
        await expect(left.getByRole("button", { name: "Close Filters" })).toBeFocused();
        await tools.click();
        await expect(left).toBeHidden();
        await expect(right).toBeVisible();
        await expect(page.locator('[data-tour="top-bar-right-menu"] button')).toHaveAccessibleName(
            "Close Tools",
        );
        await expect(filters).toHaveAttribute("aria-expanded", "false");
        await right.getByRole("button", { name: "Close Tools" }).click();
        await expect(right).toBeHidden();
        await expect(tools).toBeFocused();
        await expect(scrim).toBeHidden();

        await filters.click();
        await page.keyboard.press("Escape");
        await expect(left).toBeHidden();
        await expect(filters).toBeFocused();
        await tools.click();
        await scrim.click({ position: { x: 200, y: 200 } });
        await expect(right).toBeHidden();
        await expect(tools).toBeFocused();
        await filters.click();
        await left.getByRole("button", { name: "Close Filters" }).click();
        await expect(filters).toBeFocused();
    });
}

for (const width of [390, 500, 768]) {
    test(`compact top bar fits at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        await expect(page.locator('[data-tour="top-bar"]')).toBeVisible();
        await expect
            .poll(() =>
                page.evaluate(() =>
                    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
                ),
            )
            .toBeLessThanOrEqual(width);
        for (const label of ["Filters", "Tools"]) {
            const button = page.getByRole("button", { name: `Open ${label}`, exact: true });
            await expect(button).toBeVisible();
            const text = button.locator("span");
            if (width >= 768) {
                await expect(text).toBeVisible();
                await expect(text).toHaveText(label);
            } else {
                await expect(text).toBeVisible();
                await expect(button.locator("svg")).toBeVisible();
            }
            const box = await button.boundingBox();
            expect(box.width).toBeGreaterThanOrEqual(40);
            expect(box.height).toBeGreaterThanOrEqual(40);
        }
    });
}

test("mobile map and table remain usable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const tools = page.getByRole("button", { name: "Open Tools", exact: true });
    const box = await tools.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await tools.click();
    await page
        .locator('[data-tour="side-panel"]')
        .getByRole("button", { name: "Close Tools" })
        .click();
    await page.locator('[data-tour="mobile-main-tab-table"]').click();
    await expect(page.locator('[data-tour="spots-table"]')).toBeVisible();
    await page.locator('[data-tour="mobile-main-tab-map"]').click();
    await expect(page.locator('[data-tour="map-controls"]')).toBeVisible();
});

for (const width of [1536, 1800]) {
    test(`persistent cockpit at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        await expect(page.locator('[data-tour="left-column"]')).toBeVisible();
        await expect(page.locator('[data-tour="side-panel"]')).toBeVisible();
        await expect(
            page.getByRole("button", { name: /^(Open|Close) (Filters|Tools)$/ }),
        ).toHaveCount(0);
        await expect(
            page.getByRole("button", { name: /^Close (Filters|Tools) overlay$/ }),
        ).toHaveCount(0);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.getByRole("button", { name: "Open Tools", exact: true }).click();
        await page.setViewportSize({ width, height: 900 });
        await expect(page.locator('[data-tour="left-column"]')).toBeVisible();
        await expect(page.locator('[data-tour="side-panel"]')).toBeVisible();
        await expect(
            page.getByRole("button", { name: /^Close (Filters|Tools) overlay$/ }),
        ).toHaveCount(0);
        await page.setViewportSize({ width: 1280, height: 900 });
        await expect(page.locator('[data-tour="side-panel"]')).toBeHidden();
    });
}

for (const width of [390, 768]) {
    test(`Escape closes a drawer modal first at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        const tools = page.getByRole("button", { name: "Open Tools", exact: true });
        const drawer = page.locator('[data-tour="side-panel"]');
        await tools.click();
        await drawer.locator('[data-tour="add-filter-button-show_only"]').click();
        const modal = page.getByRole("dialog");
        await expect(modal).toBeVisible();
        await expect(modal).toHaveAttribute("aria-modal", "true");
        await page.keyboard.press("Escape");
        await expect(modal).toBeHidden();
        await expect(drawer).toBeVisible();
        await expect(page.locator('[data-tour="top-bar-right-menu"] button')).toHaveAttribute(
            "aria-expanded",
            "true",
        );
        await page.keyboard.press("Escape");
        await expect(drawer).toBeHidden();
        await expect(tools).toBeFocused();
    });
}

test.describe("configured radio", () => {
    test.use({ radio_state: { status: "connected", freq: 14074000, mode: "USB" } });

    for (const width of [390, 500, 768]) {
        test(`radio state fits at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await page.goto("/");
            const frequency = page.locator('[data-tour="top-bar-radio-frequency"]');
            await expect(frequency).toBeVisible();
            if (width < 768) {
                await expect(frequency.getByText("Radio connected", { exact: true })).toBeVisible();
                await expect(frequency.getByText("14.074 MHz", { exact: true })).toBeVisible();
            } else {
                await expect(frequency.locator('[data-tour="radio-full-frequency"]')).toBeVisible();
                for (const label of ["Filters", "Tools"]) {
                    await expect(
                        page
                            .getByRole("button", { name: `Open ${label}`, exact: true })
                            .locator("span"),
                    ).toBeVisible();
                    await expect(
                        page.getByRole("button", { name: `Open ${label}`, exact: true }),
                    ).toHaveText(label);
                }
            }
            await expect
                .poll(() =>
                    page.evaluate(() =>
                        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
                    ),
                )
                .toBeLessThanOrEqual(width);
        });
    }
});

test.describe("disconnected radio", () => {
    test.use({ radio_state: { status: "disconnected", freq: 14074000, mode: "USB" } });

    for (const width of [390, 500]) {
        test(`radio disconnect is clear at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await page.goto("/");
            const frequency = page.locator('[data-tour="top-bar-radio-frequency"]');
            await expect(frequency.getByText("Radio disconnected", { exact: true })).toBeVisible();
            await expect(frequency.getByText("14.074 MHz", { exact: true })).toBeHidden();
            await expect
                .poll(() =>
                    page.evaluate(() =>
                        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
                    ),
                )
                .toBeLessThanOrEqual(width);
        });
    }
});

for (const [width, height] of [
    [390, 844],
    [500, 900],
]) {
    test(`mobile workspace fills the shell at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto("/");
        const nav = page.getByRole("navigation", { name: "Workspace" });
        await expect(nav.getByRole("button")).toHaveText(["Map", "Table", "Filters", "Tools"]);
        const workspace = page.locator('[data-tour="mobile-workspace"]');
        const table = nav.getByRole("button", { name: "Table", exact: true });
        await table.click();
        await expect(table).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator('[data-tour="spots-table"]')).toBeVisible();
        for (const key of ["filters", "tools"]) {
            await nav
                .getByRole("button", { name: `Open ${key === "filters" ? "Filters" : "Tools"}` })
                .click();
            await expect(nav.locator(`[aria-controls="${key}-panel"]`)).toHaveAttribute(
                "aria-expanded",
                "true",
            );
        }
        await expect(page.locator('[data-tour="left-column"]')).toBeHidden();
        await page.keyboard.press("Escape");
        await expect(nav.getByRole("button", { name: "Open Tools" })).toBeFocused();
        await expect(table).toHaveAttribute("aria-pressed", "true");
        await nav.getByRole("button", { name: "Open Filters" }).click();
        await page.locator("#filters-panel-close").click();
        await expect(nav.getByRole("button", { name: "Open Filters" })).toBeFocused();
        await nav.getByRole("button", { name: "Open Tools" }).click();
        await page
            .getByRole("button", { name: "Close Tools overlay" })
            .click({ position: { x: 10, y: 10 } });
        await expect(nav.getByRole("button", { name: "Open Tools" })).toBeFocused();
        for (const name of ["Map", "Table"]) {
            await nav.getByRole("button", { name, exact: true }).click();
            const bounds = await workspace.boundingBox();
            const top = await page.locator('[data-tour="top-bar"]').boundingBox();
            const bottom = await nav.boundingBox();
            expect(bounds.y).toBeCloseTo(top.y + top.height, 0);
            expect(bounds.y + bounds.height).toBeCloseTo(bottom.y, 0);
            const content = await workspace.locator(":scope > div").boundingBox();
            expect(content.height).toBeCloseTo(bounds.height, 0);
            expect(
                await page.evaluate(() =>
                    Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
                ),
            ).toBeLessThanOrEqual(height);
            expect(
                await page.evaluate(() =>
                    Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
                ),
            ).toBeLessThanOrEqual(width);
        }
        await table.click();
        await expect
            .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mobile_panel"))))
            .toBe("table");
        await page.setViewportSize({ width: 1280, height });
        await page.setViewportSize({ width, height });
        await expect(table).toHaveAttribute("aria-pressed", "true");
    });
}

test.describe("configured radio and rotator", () => {
    for (const [width, height] of [
        [390, 844],
        [500, 900],
    ]) {
        test(`mobile task bar preserves station state at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height });
            await page.routeWebSocket("**/radio", () => {});
            await page.routeWebSocket("**/ws", websocket => {
                websocket.onMessage(message => {
                    const request = JSON.parse(message);
                    if (request.type !== "spots" || request.action !== "initial") return;
                    websocket.send(
                        JSON.stringify({
                            type: "radio",
                            event: "status",
                            status: "connected",
                            freq: 14074000,
                            mode: "USB",
                            catserver_version: "catserver-v2.0.0",
                        }),
                    );
                    websocket.send(
                        JSON.stringify({
                            type: "rotator",
                            event: "status",
                            status: "connected",
                            name: "Test rotator",
                            azimuth: 125,
                        }),
                    );
                    websocket.send(JSON.stringify({ type: "spots", event: "initial", spots: [] }));
                });
            });
            await page.goto("/");
            const top = page.locator('[data-tour="top-bar"]');
            await expect(top.getByText("14.074 MHz", { exact: true })).toBeVisible();
            await expect(top.getByRole("img", { name: "Rotator connected" })).toBeVisible();
            await top.getByRole("button", { name: "Disable rotator tuning" }).click();
            await expect(top.getByRole("button", { name: "Enable rotator tuning" })).toBeVisible();
            await expect(top.locator('[data-tour="top-bar-network-state"]')).toBeVisible();
            await expect(top.getByRole("combobox", { name: "Spot window" })).toBeVisible();
            await expect(top.locator('[data-tour="top-bar-submit-spot"]')).toBeVisible();
            await expect(top.locator('[data-tour="top-bar-settings"]')).toBeVisible();
            await expect(top.locator('[data-tour="top-bar-logo"]')).toHaveCount(0);
            expect((await top.boundingBox()).height).toBeLessThanOrEqual(110);
            expect(
                await page.evaluate(() =>
                    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
                ),
            ).toBeLessThanOrEqual(width);
            expect(
                await page.evaluate(() =>
                    Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
                ),
            ).toBeLessThanOrEqual(height);
        });
    }
});

for (const width of [767, 768, 1535, 1536]) {
    test(`uses one navigation model at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        const top = page.locator('[data-tour="top-bar"]');
        const nav = page.getByRole("navigation", { name: "Workspace" });
        if (width < 768) {
            await expect(nav).toBeVisible();
            await expect(nav.getByRole("button")).toHaveText(["Map", "Table", "Filters", "Tools"]);
            await expect(top.locator('[data-tour="top-bar-left-menu"]')).toHaveCount(0);
            await expect(top.locator('[data-tour="top-bar-right-menu"]')).toHaveCount(0);
        } else {
            await expect(nav).toHaveCount(0);
            for (const name of ["map", "table"]) {
                await expect(page.locator(`[data-tour="${name}-panel"]`)).toBeVisible();
            }
            await expect(
                top.getByRole("button", { name: /^(Open|Close) (Filters|Tools)$/ }),
            ).toHaveCount(width < 1536 ? 2 : 0);
        }
        await expect(top.locator('[data-tour^="mobile-main-tab"]')).toHaveCount(0);
        await expect(page.getByRole("button", { name: /hamburger|menu/i })).toHaveCount(0);
    });
}

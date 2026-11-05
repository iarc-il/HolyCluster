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
                await expect(text).toBeHidden();
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

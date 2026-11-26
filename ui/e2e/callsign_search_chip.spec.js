import { expect, test, tour_target } from "./fixtures/tour.js";

test("a custom range does not push the search chip out of its row", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expect(page.locator(tour_target("spot-row")).first()).toBeVisible();

    await page.locator(tour_target("table-search-history-search")).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("input").first().fill("JA1XYZ");
    const selects = dialog.locator("select");
    await selects.nth(0).selectOption("custom");
    await selects.nth(1).selectOption("custom");
    await dialog.getByLabel(/^From .* date$/).fill("2026-11-20");
    await dialog.getByLabel(/^From .* time$/).fill("08:00");
    await dialog.getByLabel(/^To .* date$/).fill("2026-11-25");
    await dialog.getByLabel(/^To .* time$/).fill("20:30");
    await page.locator(tour_target("modal-apply-button")).click();

    const row = page.locator(tour_target("table-search"));
    const chip = row.locator(tour_target("callsign-search-chip"));
    await expect(chip).toContainText("JA1XYZ");
    await expect(chip).toContainText("Custom");

    // The range text must truncate instead of pushing the exit button out of
    // the chip and over the reference selector
    const chip_box = await chip.boundingBox();
    const exit_box = await chip.getByLabel("Exit callsign search").boundingBox();
    expect(exit_box.x + exit_box.width).toBeLessThanOrEqual(chip_box.x + chip_box.width + 1);

    const selector_box = await row
        .locator(tour_target("table-search-reference-selector"))
        .boundingBox();
    expect(chip_box.x + chip_box.width).toBeLessThanOrEqual(selector_box.x);
});

test("the chip replaces the history button during a search", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expect(page.locator(tour_target("spot-row")).first()).toBeVisible();

    const row = page.locator(tour_target("table-search"));
    const history_button = row.locator(tour_target("table-search-history-search"));
    await history_button.click();
    await page.getByRole("dialog").locator("input").first().fill("JA1XYZ");
    await page.locator(tour_target("modal-apply-button")).click();

    const chip = row.locator(tour_target("callsign-search-chip"));
    await expect(chip).toContainText("JA1XYZ");
    await expect(history_button).toHaveCount(0);

    // The chip opens the same modal to edit the search
    await chip.getByText("JA1XYZ").click();
    await expect(page.getByRole("dialog").locator("input").first()).toHaveValue("JA1XYZ");
    await page.keyboard.press("Escape");

    await chip.getByLabel("Exit callsign search").click();
    await expect(chip).toHaveCount(0);
    await expect(history_button).toBeVisible();
});

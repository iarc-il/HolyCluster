import {
    back_tour_step,
    expect,
    expect_tour_step,
    next_tour_step,
    start_tour,
    test,
    tour_target,
} from "../fixtures/tour.js";

for (const [chapter, panel, first_step, next_step, next_target] of [
    ["Map", "map", "map_show_the_map", "map_controls", "map-controls"],
    [
        "Spots Table",
        "table",
        "spots_table_show_the_table",
        "spots_table_callsign_search_mobile",
        "table-search-mobile",
    ],
]) {
    test(`${chapter} keeps its workspace when navigating Back`, async ({ page }) => {
        await page.setViewportSize({ width: 767, height: 900 });
        await page.goto("/");
        await page
            .locator(tour_target(`mobile-main-tab-${panel === "map" ? "table" : "map"}`))
            .click();
        await start_tour(page, chapter);
        const destination = page.locator(tour_target(`mobile-main-tab-${panel}`));
        await expect_tour_step(page, first_step, tour_target(`mobile-main-tab-${panel}`));
        await destination.click();
        await expect_tour_step(page, next_step, tour_target(next_target));
        await back_tour_step(page);
        await expect_tour_step(page, first_step, tour_target(`mobile-main-tab-${panel}`));
        await expect(destination).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator(tour_target("left-column"))).toBeHidden();
        await expect(page.locator(tour_target("side-panel"))).toBeHidden();
        await next_tour_step(page);
        await expect_tour_step(page, next_step, tour_target(next_target));
    });
}

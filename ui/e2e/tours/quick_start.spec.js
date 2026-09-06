import {
    expect,
    expect_tour_step,
    finish_tour,
    next_tour_step,
    start_tour,
    test,
    tour_target,
} from "../fixtures/tour.js";

test.use({ viewport: { width: 1800, height: 1000 } });

test("completes the Quick Start workflow on full desktop", async ({ page }) => {
    await page.goto("/");

    await start_tour(page, "Quick Start");

    await expect_tour_step(page, "quick_start_welcome", tour_target("top-bar"));
    await next_tour_step(page);
    await expect_tour_step(page, "quick_start_spot_window", tour_target("top-bar-time-limit"));
    await next_tour_step(page);
    await expect_tour_step(page, "quick_start_submit_spots", tour_target("top-bar-submit-spot"));
    await next_tour_step(page);
    await expect_tour_step(page, "quick_start_band_and_mode_filters", tour_target("left-column"));
    await next_tour_step(page);
    await expect_tour_step(page, "quick_start_find_activity", tour_target("map-panel"));
    await next_tour_step(page);
    await expect_tour_step(page, "quick_start_inspect_a_spot", tour_target("table-panel"));

    await finish_tour(page);
    await expect(page.locator(".react-joyride__overlay")).toBeHidden();
});

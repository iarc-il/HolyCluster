import {
    expect,
    expect_tour_step,
    finish_tour,
    next_tour_step,
    start_tour,
    test,
    tour_target,
} from "../fixtures/tour.js";

test.describe("Quick Start on mobile", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("completes the mobile workflow", async ({ page }) => {
        await page.goto("/");
        await start_tour(page, "Quick Start");

        await expect_tour_step(page, "quick_start_welcome", tour_target("top-bar"));
        await next_tour_step(page);
        await expect_tour_step(page, "quick_start_spot_window", tour_target("top-bar-time-limit"));
        const time_limit = page.locator(tour_target("top-bar-time-limit"));
        await time_limit.selectOption("900");
        await expect(time_limit).toHaveValue("900");
        await next_tour_step(page);
        await expect_tour_step(
            page,
            "quick_start_submit_spots",
            tour_target("top-bar-submit-spot"),
        );
        await page.locator(tour_target("top-bar-submit-spot")).click();
        await expect(page.locator(tour_target("submit-spot-modal"))).toBeVisible();
        await page.locator(tour_target("modal-cancel-button")).click();
        await expect(page.locator(tour_target("submit-spot-modal"))).toBeHidden();
        await next_tour_step(page);
        await expect_tour_step(
            page,
            "quick_start_open_filter_rail",
            tour_target("top-bar-left-menu"),
        );
        await page.locator(tour_target("top-bar-left-menu")).locator("button").click();
        await expect(page.locator(tour_target("left-column"))).toBeVisible();
        await expect_tour_step(
            page,
            "quick_start_band_and_mode_filters",
            tour_target("left-column"),
        );
        const band_filter = page.locator(tour_target("band-filter-20"));
        const mode_filter = page.locator(tour_target("mode-filter-SSB"));
        const band_state_before = await band_filter.getAttribute("aria-pressed");
        const mode_state_before = await mode_filter.getAttribute("aria-pressed");
        await band_filter.click();
        await mode_filter.click();
        await expect(band_filter).not.toHaveAttribute("aria-pressed", band_state_before);
        await expect(mode_filter).not.toHaveAttribute("aria-pressed", mode_state_before);
        await next_tour_step(page);
        await expect_tour_step(
            page,
            "quick_start_map_and_table_tabs",
            tour_target("mobile-main-tabs"),
        );
        const table_tab = page.locator(tour_target("mobile-main-tab-table"));
        await table_tab.click();
        await expect(table_tab).toHaveAttribute("data-tour-state", "active");
        await expect(page.locator(tour_target("spots-table"))).toBeVisible();

        await finish_tour(page);
    });
});

test.describe("Quick Start on reduced desktop", () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test("completes the reduced desktop workflow", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator(tour_target("spot-row"))).toBeVisible();
        await start_tour(page, "Quick Start");

        await expect_tour_step(page, "quick_start_welcome", tour_target("top-bar"));
        await next_tour_step(page);
        await expect_tour_step(page, "quick_start_spot_window", tour_target("top-bar-time-limit"));
        const time_limit = page.locator(tour_target("top-bar-time-limit"));
        await time_limit.selectOption("900");
        await expect(time_limit).toHaveValue("900");
        await next_tour_step(page);
        await expect_tour_step(
            page,
            "quick_start_submit_spots",
            tour_target("top-bar-submit-spot"),
        );
        await page.locator(tour_target("top-bar-submit-spot")).click();
        await expect(page.locator(tour_target("submit-spot-modal"))).toBeVisible();
        await page.locator(tour_target("modal-cancel-button")).click();
        await expect(page.locator(tour_target("submit-spot-modal"))).toBeHidden();
        await next_tour_step(page);
        await expect_tour_step(
            page,
            "quick_start_open_filter_rail",
            tour_target("top-bar-left-menu"),
        );
        await expect(page.locator(tour_target("left-column"))).toBeVisible();
        await next_tour_step(page);
        await expect_tour_step(
            page,
            "quick_start_band_and_mode_filters",
            tour_target("left-column"),
        );
        const band_filter = page.locator(tour_target("band-filter-20"));
        const mode_filter = page.locator(tour_target("mode-filter-SSB"));
        const band_state_before = await band_filter.getAttribute("aria-pressed");
        const mode_state_before = await mode_filter.getAttribute("aria-pressed");
        await band_filter.click();
        await mode_filter.click();
        await expect(band_filter).not.toHaveAttribute("aria-pressed", band_state_before);
        await expect(mode_filter).not.toHaveAttribute("aria-pressed", mode_state_before);
        await next_tour_step(page);
        await expect_tour_step(page, "quick_start_find_activity", tour_target("map-panel"));
        await next_tour_step(page);
        await expect_tour_step(page, "quick_start_inspect_a_spot", tour_target("table-panel"));
        const spot_row = page.locator(tour_target("spot-row"));
        await spot_row.click();
        await expect(spot_row).toHaveAttribute("data-tour-state", "pinned");

        await finish_tour(page);
    });
});

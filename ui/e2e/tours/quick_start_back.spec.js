import {
    back_tour_step,
    expect,
    expect_tour_step,
    finish_tour,
    next_tour_step,
    start_tour,
    test,
    tour_target,
} from "../fixtures/tour.js";

async function go_back_and_forward(page, current_step, previous_step) {
    await expect_tour_step(page, current_step.id, tour_target(current_step.target));
    await back_tour_step(page);
    await expect_tour_step(page, previous_step.id, tour_target(previous_step.target));
    await next_tour_step(page);
    await expect_tour_step(page, current_step.id, tour_target(current_step.target));
}

const full_desktop_steps = [
    { id: "quick_start_welcome", target: "top-bar" },
    { id: "quick_start_spot_window", target: "top-bar-time-limit" },
    { id: "quick_start_submit_spots", target: "top-bar-submit-spot" },
    { id: "quick_start_band_and_mode_filters", target: "left-column" },
    { id: "quick_start_find_activity", target: "map-panel" },
    { id: "quick_start_inspect_a_spot", target: "table-panel" },
];

test.describe("Quick Start Back navigation", () => {
    test.use({ viewport: { width: 1800, height: 1000 } });

    test("returns to every previous desktop step", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator(tour_target("spot-row"))).toBeVisible();
        await start_tour(page, "Quick Start");

        await expect_tour_step(
            page,
            full_desktop_steps[0].id,
            tour_target(full_desktop_steps[0].target),
        );
        for (let index = 1; index < full_desktop_steps.length; index += 1) {
            await next_tour_step(page);
            await go_back_and_forward(
                page,
                full_desktop_steps[index],
                full_desktop_steps[index - 1],
            );
        }

        await finish_tour(page);
    });

    test.describe("mobile", () => {
        test.use({ viewport: { width: 390, height: 844 } });

        test("returns to the filter-rail prompt after opening it", async ({ page }) => {
            await page.goto("/");
            await start_tour(page, "Quick Start");

            const welcome = { id: "quick_start_welcome", target: "top-bar" };
            const spot_window = { id: "quick_start_spot_window", target: "top-bar-time-limit" };
            const submit_spots = { id: "quick_start_submit_spots", target: "top-bar-submit-spot" };
            const open_filter_rail = {
                id: "quick_start_open_filter_rail",
                target: "top-bar-left-menu",
            };
            const band_filters = {
                id: "quick_start_band_and_mode_filters",
                target: "left-column",
            };
            const mobile_tabs = {
                id: "quick_start_map_and_table_tabs",
                target: "mobile-main-tabs",
            };

            await expect_tour_step(page, welcome.id, tour_target(welcome.target));
            await next_tour_step(page);
            await go_back_and_forward(page, spot_window, welcome);
            await next_tour_step(page);
            await go_back_and_forward(page, submit_spots, spot_window);
            await next_tour_step(page);
            await expect_tour_step(page, open_filter_rail.id, tour_target(open_filter_rail.target));
            await back_tour_step(page);
            await expect_tour_step(page, submit_spots.id, tour_target(submit_spots.target));
            await next_tour_step(page);
            await expect_tour_step(page, open_filter_rail.id, tour_target(open_filter_rail.target));

            await page.locator(tour_target("top-bar-left-menu")).locator("button").click();
            await expect(page.locator(tour_target("left-column"))).toBeVisible();
            await expect_tour_step(page, band_filters.id, tour_target(band_filters.target));
            await back_tour_step(page);
            await expect_tour_step(page, open_filter_rail.id, tour_target(open_filter_rail.target));
            await next_tour_step(page);
            await expect_tour_step(page, band_filters.id, tour_target(band_filters.target));
            await next_tour_step(page);
            await go_back_and_forward(page, mobile_tabs, band_filters);

            await finish_tour(page);
        });
    });
});

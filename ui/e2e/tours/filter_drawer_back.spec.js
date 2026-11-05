import {
    back_tour_step,
    expect,
    expect_tour_step,
    next_tour_step,
    start_tour,
    test,
    tour_target,
} from "../fixtures/tour.js";

for (const width of [390, 1280]) {
    test.describe(`Filters drawer Back at ${width}px`, () => {
        test.use({ viewport: { width, height: 900 } });

        for (const chapter of ["Quick Start", "Filters"]) {
            test(`${chapter} restores the closed opener`, async ({ page }) => {
                await page.goto("/");
                await start_tour(page, chapter);

                const prefix = chapter === "Quick Start" ? "quick_start" : "filters";
                if (chapter === "Quick Start") {
                    await expect_tour_step(page, "quick_start_welcome", tour_target("top-bar"));
                    await next_tour_step(page);
                    await expect_tour_step(
                        page,
                        "quick_start_spot_window",
                        tour_target("top-bar-time-limit"),
                    );
                    await next_tour_step(page);
                    await expect_tour_step(
                        page,
                        "quick_start_submit_spots",
                        tour_target("top-bar-submit-spot"),
                    );
                    await next_tour_step(page);
                }

                const opener = page
                    .locator(tour_target("top-bar-left-menu"))
                    .getByRole("button", { name: "Open Filters", exact: true });
                const drawer = page.locator(tour_target("left-column"));
                const content_id =
                    chapter === "Quick Start"
                        ? "quick_start_band_and_mode_filters"
                        : "filters_quick_filters";

                await expect_tour_step(
                    page,
                    `${prefix}_open_filter_rail`,
                    tour_target("top-bar-left-menu"),
                );
                await opener.click();
                await expect_tour_step(page, content_id, tour_target("left-column"));
                await back_tour_step(page);
                await expect_tour_step(
                    page,
                    `${prefix}_open_filter_rail`,
                    tour_target("top-bar-left-menu"),
                );
                await expect(drawer).toBeHidden();
                await expect(opener).toBeVisible();
                await expect(opener).toHaveAttribute("aria-expanded", "false");

                await opener.click();
                await expect(drawer).toBeVisible();
                await expect_tour_step(page, content_id, tour_target("left-column"));
                await expect(
                    page.getByRole("button", { name: "Close Filters", exact: true }).first(),
                ).toBeVisible();
            });
        }
    });
}

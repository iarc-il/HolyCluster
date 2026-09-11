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

async function expect_state_change(locator, action) {
    const previous_state = await locator.getAttribute("data-tour-state");
    await action();
    await expect(locator).not.toHaveAttribute("data-tour-state", previous_state);
}

async function complete_map_controls(page, { mobile = false } = {}) {
    await expect_tour_step(
        page,
        mobile ? "map_show_the_map" : "map_view",
        tour_target(mobile ? "mobile-main-tab-map" : "map-panel"),
    );
    await next_tour_step(page);

    await expect_tour_step(page, "map_controls", tour_target("map-controls"));
    await next_tour_step(page);

    if (mobile) {
        await expect_tour_step(page, "map_gps_location", tour_target("map-gps"));
        await next_tour_step(page);
    }

    await expect_tour_step(page, "map_reset", tour_target("map-reset"));
    await next_tour_step(page);

    if (!mobile) {
        await expect_tour_step(page, "map_fullscreen", tour_target("map-fullscreen"));
        await next_tour_step(page);
    }

    await expect_tour_step(page, "map_open_controls", tour_target("map-controls-toggle"));
    await page.locator(tour_target("map-controls-toggle")).click();
    await expect(page.locator(tour_target("map-controls-panel"))).toBeVisible();

    await expect_tour_step(page, "map_display_panel", tour_target("map-controls-panel"));
    await next_tour_step(page);

    const night = page.locator(tour_target("map-night-toggle"));
    await expect_tour_step(page, "map_try_night_overlay", tour_target("map-night-toggle"));
    await expect_state_change(night, () => night.click());
    await expect_tour_step(page, "map_try_projection", tour_target("map-projection-toggle"));

    const projection = page.locator(tour_target("map-projection-toggle"));
    await expect_tour_step(page, "map_try_projection", tour_target("map-projection-toggle"));
    await expect_state_change(projection, () => projection.click());
    await expect_tour_step(page, "map_try_equator", tour_target("map-equator-toggle"));

    const equator = page.locator(tour_target("map-equator-toggle"));
    await expect_tour_step(page, "map_try_equator", tour_target("map-equator-toggle"));
    await expect_state_change(equator, () => equator.click());
    await expect_tour_step(page, "map_themes", tour_target("map-theme-buttons"));
    const themes = page.locator(tour_target("map-theme-buttons"));
    const current_theme = await themes.getAttribute("data-tour-state");
    const next_theme = current_theme === "earth" ? "white" : "earth";
    await page.getByRole("button", { name: `Use ${next_theme} map theme` }).click();
    await expect(themes).toHaveAttribute("data-tour-state", next_theme);
    await expect_tour_step(page, "map_zone_overlay", tour_target("map-overlays"));
    const overlays = page.locator(tour_target("map-overlays"));
    const overlays_before = await overlays.getAttribute("data-tour-state");
    await page.locator(tour_target("map-overlay-dxcc")).click();
    await expect(overlays).not.toHaveAttribute("data-tour-state", overlays_before);
    await expect_tour_step(page, "map_regional_overlay", tour_target("map-region-overlays"));
    await page.locator(tour_target("map-region-overlay-us_state")).click();
    await expect(page.locator(".react-joyride__tooltip")).toBeHidden();
    await expect(page.locator(tour_target("map-controls-panel"))).toBeHidden();
}

test.describe("Map tour", () => {
    test("completes every applicable desktop step", async ({ page }) => {
        await page.setViewportSize({ width: 1800, height: 1000 });
        await page.goto("/");
        await expect(page.locator(tour_target("map-panel"))).toBeVisible();

        await start_tour(page, "Map");
        await complete_map_controls(page);
    });

    test("completes every applicable mobile step", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/");
        await start_tour(page, "Map");

        await complete_map_controls(page, { mobile: true });
    });

    test("restores map controls when navigating Back", async ({ page }) => {
        await page.setViewportSize({ width: 1800, height: 1000 });
        await page.goto("/");
        await start_tour(page, "Map");

        await expect_tour_step(page, "map_view", tour_target("map-panel"));
        await next_tour_step(page);
        await expect_tour_step(page, "map_controls", tour_target("map-controls"));
        await next_tour_step(page);
        await expect_tour_step(page, "map_reset", tour_target("map-reset"));
        await next_tour_step(page);
        await expect_tour_step(page, "map_fullscreen", tour_target("map-fullscreen"));
        await next_tour_step(page);
        await expect_tour_step(page, "map_open_controls", tour_target("map-controls-toggle"));
        await page.locator(tour_target("map-controls-toggle")).click();
        await expect_tour_step(page, "map_display_panel", tour_target("map-controls-panel"));

        await back_tour_step(page);
        await expect_tour_step(page, "map_open_controls", tour_target("map-controls-toggle"));
        await expect(page.locator(tour_target("map-controls-panel"))).toBeHidden();
        await page.locator(tour_target("map-controls-toggle")).click();
        await expect_tour_step(page, "map_display_panel", tour_target("map-controls-panel"));
        await next_tour_step(page);

        await expect_tour_step(page, "map_try_night_overlay", tour_target("map-night-toggle"));
        await back_tour_step(page);
        await expect_tour_step(page, "map_display_panel", tour_target("map-controls-panel"));
        await expect(page.locator(tour_target("map-projection-toggle"))).toBeVisible();
        await next_tour_step(page);
        await expect_tour_step(page, "map_try_night_overlay", tour_target("map-night-toggle"));
        await expect_state_change(page.locator(tour_target("map-night-toggle")), () =>
            page.locator(tour_target("map-night-toggle")).click(),
        );
        await expect_tour_step(page, "map_try_projection", tour_target("map-projection-toggle"));
        await expect_state_change(page.locator(tour_target("map-projection-toggle")), () =>
            page.locator(tour_target("map-projection-toggle")).click(),
        );
        await expect_tour_step(page, "map_try_equator", tour_target("map-equator-toggle"));
        await expect_state_change(page.locator(tour_target("map-equator-toggle")), () =>
            page.locator(tour_target("map-equator-toggle")).click(),
        );
        await expect_tour_step(page, "map_themes", tour_target("map-theme-buttons"));
        const current_theme = await page
            .locator(tour_target("map-theme-buttons"))
            .getAttribute("data-tour-state");
        await page
            .getByRole("button", {
                name: `Use ${current_theme === "earth" ? "white" : "earth"} map theme`,
            })
            .click();
        await expect_tour_step(page, "map_zone_overlay", tour_target("map-overlays"));
        await page.locator(tour_target("map-overlay-dxcc")).click();
        await expect_tour_step(page, "map_regional_overlay", tour_target("map-region-overlays"));
        await page.locator(tour_target("map-region-overlay-us_state")).click();
        await expect(page.locator(".react-joyride__tooltip")).toBeHidden();
    });
});

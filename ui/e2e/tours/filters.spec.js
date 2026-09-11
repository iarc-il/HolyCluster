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

async function open_band_options(page) {
    const band_filter = page.locator(tour_target("band-filter-20"));
    await expect_tour_step(page, "filters_band_filters", tour_target("band-filter-20"));
    await expect_state_change(band_filter, () => band_filter.click());

    await expect_tour_step(
        page,
        "filters_open_band_options",
        tour_target("filter-options-trigger-bands-20"),
    );
    await page.locator(tour_target("filter-options-trigger-bands-20")).hover();
    await expect(page.locator(tour_target("filter-options-popup"))).toBeVisible();
    await expect_tour_step(
        page,
        "filters_open_band_options",
        tour_target("filter-options-trigger-bands-20"),
    );
    await next_tour_step(page);
    await expect_tour_step(page, "filters_only_and_all", tour_target("filter-options-popup"));
    await next_tour_step(page);
}

async function reach_filter_editor(page, { mobile = false } = {}) {
    if (mobile) {
        await expect_tour_step(page, "filters_open_filter_rail", tour_target("top-bar-left-menu"));
        await page.locator(tour_target("top-bar-left-menu")).locator("button").click();
        await expect(page.locator(tour_target("left-column"))).toBeVisible();
    }

    await expect_tour_step(page, "filters_quick_filters", tour_target("left-column"));
    await next_tour_step(page);
    await open_band_options(page);

    const mode_filter = page.locator(tour_target("mode-filter-SSB"));
    await expect_tour_step(page, "filters_mode_filters", tour_target("mode-filter-SSB"));
    await expect_state_change(mode_filter, () => mode_filter.click());

    if (mobile) {
        await expect_tour_step(page, "filters_open_side_panel", tour_target("top-bar-right-menu"));
        await page.locator(tour_target("top-bar-right-menu")).locator("button").click();
        await expect(page.locator(tour_target("side-panel"))).toBeVisible();
    }

    await expect_tour_step(page, "filters_filters_tab", tour_target("side-panel-tab-filters"));
    await next_tour_step(page);
    await expect_tour_step(page, "filters_advanced_filters", tour_target("filters-panel"));
    await next_tour_step(page);

    await expect_tour_step(page, "filters_alert_filters", tour_target("filter-section-alert"));
    await next_tour_step(page);
    await expect_tour_step(
        page,
        "filters_show_only_filters",
        tour_target("filter-section-show_only"),
    );
    await next_tour_step(page);
    await expect_tour_step(page, "filters_hide_filters", tour_target("filter-section-hide"));
    await next_tour_step(page);

    await expect_tour_step(page, "filters_create_a_filter", tour_target("add-filter-button-alert"));
    await page.locator(tour_target("add-filter-button-alert")).click();
    await expect(page.locator(tour_target("filter-modal-content")).first()).toBeVisible();
    await expect_tour_step(page, "filters_filter_editor", tour_target("filter-modal-content"));
}

async function complete_filter_editor(page) {
    await next_tour_step(page);
    await expect_tour_step(page, "filters_filter_action", tour_target("filter-modal-action-alert"));
    await next_tour_step(page);
    await expect_tour_step(page, "filters_filter_type", tour_target("filter-modal-type-prefix"));
    await next_tour_step(page);
    await expect_tour_step(page, "filters_dx_or_spotter", tour_target("filter-modal-spot-role-dx"));
    await next_tour_step(page);

    const value = page.locator(tour_target("filter-modal-text-value"));
    await expect_tour_step(page, "filters_type_a_value", tour_target("filter-modal-text-value"));
    await value.fill("K");
    await next_tour_step(page);

    await expect_tour_step(page, "filters_add_a_filter", tour_target("modal-apply-button"));
    await page.locator(tour_target("modal-apply-button")).click();
    await expect(page.locator(tour_target("filter-line-alert"))).toBeVisible();
    await expect_tour_step(page, "filters_drag_the_new_filter", tour_target("filter-line-alert"));

    const show_only_section = page.locator(tour_target("filter-section-show_only"));
    await drag_filter_to_show_only(page);
    await expect(show_only_section).toHaveAttribute("data-tour-state", "1");
    await expect_tour_step(page, "filters_filter_moved", tour_target("filter-section-show_only"));
    await finish_tour(page);
}

async function complete_filters(page, { mobile = false } = {}) {
    await reach_filter_editor(page, { mobile });
    await complete_filter_editor(page);
}

test.describe("Filters tour", () => {
    test("completes every applicable desktop step", async ({ page }) => {
        await page.setViewportSize({ width: 1800, height: 1000 });
        await page.goto("/");
        await start_tour(page, "Filters");
        await complete_filters(page);
    });

    test("completes every applicable mobile step", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/");
        await start_tour(page, "Filters");
        await complete_filters(page, { mobile: true });
    });

    test("restores filter UI and created filters when navigating Back", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/");
        await start_tour(page, "Filters");

        await reach_filter_editor(page, { mobile: true });
        await back_tour_step(page);
        await expect_tour_step(
            page,
            "filters_create_a_filter",
            tour_target("add-filter-button-alert"),
        );
        await expect(page.locator(tour_target("filter-modal-content")).first()).toBeHidden();
        await page.locator(tour_target("add-filter-button-alert")).click();
        await expect_tour_step(page, "filters_filter_editor", tour_target("filter-modal-content"));

        await complete_filter_editor_until_drag_prompt(page);
        await back_tour_step(page);
        await expect_tour_step(
            page,
            "filters_create_a_filter",
            tour_target("add-filter-button-alert"),
        );
        await expect(page.locator(tour_target("filter-line-alert"))).toBeHidden();
        await page.locator(tour_target("add-filter-button-alert")).click();
        await expect_tour_step(page, "filters_filter_editor", tour_target("filter-modal-content"));

        await complete_filter_editor_until_moved(page);
        await back_tour_step(page);
        await expect_tour_step(
            page,
            "filters_drag_the_new_filter",
            tour_target("filter-line-alert"),
        );
        await expect(page.locator(tour_target("filter-line-alert"))).toBeVisible();
        await expect(page.locator(tour_target("filter-section-show_only"))).toHaveAttribute(
            "data-tour-state",
            "0",
        );
        await drag_filter_to_show_only(page);
        await expect_tour_step(
            page,
            "filters_filter_moved",
            tour_target("filter-section-show_only"),
        );
        await finish_tour(page);
    });

    test("closes the forced band popup when navigating Back", async ({ page }) => {
        await page.setViewportSize({ width: 1800, height: 1000 });
        await page.goto("/");
        await start_tour(page, "Filters");

        await expect_tour_step(page, "filters_quick_filters", tour_target("left-column"));
        await next_tour_step(page);
        await open_band_options(page);

        await back_tour_step(page);
        await expect_tour_step(page, "filters_only_and_all", tour_target("filter-options-popup"));
        await back_tour_step(page);
        await expect_tour_step(page, "filters_band_filters", tour_target("band-filter-20"));
        await expect(page.locator(tour_target("filter-options-popup"))).toBeHidden();
        await expect_state_change(page.locator(tour_target("band-filter-20")), () =>
            page.locator(tour_target("band-filter-20")).click(),
        );
        await expect_tour_step(
            page,
            "filters_open_band_options",
            tour_target("filter-options-trigger-bands-20"),
        );
        await page.locator(tour_target("filter-options-trigger-bands-20")).hover();
        await expect_tour_step(
            page,
            "filters_open_band_options",
            tour_target("filter-options-trigger-bands-20"),
        );
        await next_tour_step(page);
        await expect_tour_step(page, "filters_only_and_all", tour_target("filter-options-popup"));
        await next_tour_step(page);
        await expect_tour_step(page, "filters_mode_filters", tour_target("mode-filter-SSB"));
        await expect_state_change(page.locator(tour_target("mode-filter-SSB")), () =>
            page.locator(tour_target("mode-filter-SSB")).click(),
        );
        await expect_tour_step(page, "filters_filters_tab", tour_target("side-panel-tab-filters"));
        await page.locator(".react-joyride__tooltip [data-testid='button-close']").click();
        await expect(page.locator(".react-joyride__tooltip")).toBeHidden();
    });
});

async function fill_filter_steps(page) {
    await next_tour_step(page);
    await next_tour_step(page);
    await next_tour_step(page);
    await next_tour_step(page);
    await page.locator(tour_target("filter-modal-text-value")).fill("K");
    await next_tour_step(page);
    await page.locator(tour_target("modal-apply-button")).click();
    await expect_tour_step(page, "filters_drag_the_new_filter", tour_target("filter-line-alert"));
}

async function complete_filter_editor_until_drag_prompt(page) {
    await expect_tour_step(page, "filters_filter_editor", tour_target("filter-modal-content"));
    await fill_filter_steps(page);
}

async function complete_filter_editor_until_moved(page) {
    await complete_filter_editor_until_drag_prompt(page);
    await drag_filter_to_show_only(page);
    await expect_tour_step(page, "filters_filter_moved", tour_target("filter-section-show_only"));
}

async function drag_filter_to_show_only(page) {
    const source = page.locator(tour_target("filter-line-alert"));
    const target = page.locator(tour_target("filter-section-show_only"));
    const target_box = await target.boundingBox();
    expect(target_box).not.toBeNull();

    const drop_points = [
        { x: target_box.x + target_box.width - 4, y: target_box.y + target_box.height / 2 },
        { x: target_box.x + 4, y: target_box.y + target_box.height - 4 },
    ];

    for (const drop_point of drop_points) {
        const source_box = await source.boundingBox();
        expect(source_box).not.toBeNull();
        await page.mouse.move(
            source_box.x + source_box.width / 2,
            source_box.y + source_box.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(drop_point.x, drop_point.y, { steps: 12 });
        await page.mouse.up();

        if ((await target.getAttribute("data-tour-state")) === "1") return;
    }

    await expect(target).toHaveAttribute("data-tour-state", "1");
}

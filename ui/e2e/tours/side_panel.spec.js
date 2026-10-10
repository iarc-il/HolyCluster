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

async function open_side_panel(page) {
    await expect_tour_step(page, "side_panel_open_side_panel", tour_target("top-bar-right-menu"));
    await page.locator(tour_target("top-bar-right-menu")).locator("button").click();
    await expect(page.locator(tour_target("side-panel"))).toBeVisible();
}

async function click_side_panel_tab(page, id, target, label) {
    await expect_tour_step(page, id, tour_target(target));
    await page.locator(tour_target(target)).click();
    await expect_tour_step(page, label.id, tour_target(label.target));
}

async function complete_side_panel(page, { mobile = false } = {}) {
    if (mobile) {
        await open_side_panel(page);
    }

    await expect_tour_step(page, "side_panel_overview", tour_target("side-panel"));
    await next_tour_step(page);
    await expect_tour_step(page, "side_panel_tabs", tour_target("side-panel-tabs"));
    await next_tour_step(page);

    await expect_tour_step(page, "side_panel_filters_tab", tour_target("side-panel-tab-filters"));
    await next_tour_step(page);
    await expect_tour_step(page, "side_panel_filters_view", tour_target("side-panel-view-filters"));
    await next_tour_step(page);

    await click_side_panel_tab(page, "side_panel_band_bar_tab", "side-panel-tab-band-bar", {
        id: "side_panel_band_activity",
        target: "band-bar-panel",
    });
    await next_tour_step(page);
    await expect_tour_step(page, "side_panel_band_selector", tour_target("band-bar-selector"));
    await page.locator(tour_target("band-bar-band-select")).selectOption("20");
    await expect(page.locator(tour_target("band-bar-band-select"))).toHaveValue("20");
    await next_tour_step(page);
    await expect_tour_step(page, "side_panel_activity_chart", tour_target("band-bar-chart"));
    await next_tour_step(page);

    await click_side_panel_tab(page, "side_panel_heatmap_tab", "side-panel-tab-heatmap", {
        id: "side_panel_heatmap",
        target: "heatmap-panel",
    });
    await next_tour_step(page);
    await expect_tour_step(
        page,
        "side_panel_heatmap_region",
        tour_target("heatmap-continent-selector"),
    );
    await page.locator(tour_target("heatmap-continent-selector")).selectOption("NA");
    await expect(page.locator(tour_target("heatmap-continent-selector"))).toHaveValue("NA");
    await next_tour_step(page);

    await click_side_panel_tab(page, "side_panel_dxpeditions_tab", "side-panel-tab-dxpeditions", {
        id: "side_panel_dxpeditions",
        target: "dxpeditions-panel",
    });
    await next_tour_step(page);
    await expect_tour_step(
        page,
        "side_panel_dxpedition_summary",
        tour_target("dxpeditions-summary"),
    );
    await next_tour_step(page);
    await expect_tour_step(
        page,
        "side_panel_dxpedition_filters",
        tour_target("dxpeditions-filter"),
    );
    await page.locator(tour_target("dxpeditions-filter-upcoming")).click();
    await next_tour_step(page);
    await expect_tour_step(page, "side_panel_dxpedition_sorting", tour_target("dxpeditions-sort"));
    await page.locator(tour_target("dxpeditions-sort-start")).click();
    await next_tour_step(page);

    await click_side_panel_tab(page, "side_panel_missing_tab", "side-panel-tab-missing", {
        id: "side_panel_missing",
        target: "missing-panel",
    });
    await next_tour_step(page);
    await expect_tour_step(page, "side_panel_adif_import", tour_target("missing-adif-import"));
    await finish_tour(page);
}

test.describe("Side Panel tour", () => {
    test("completes every applicable desktop step", async ({ page }) => {
        await page.setViewportSize({ width: 1800, height: 1000 });
        await page.goto("/");
        await start_tour(page, "Side Panel");
        await complete_side_panel(page);
    });

    test("completes every applicable mobile step", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/");
        await start_tour(page, "Side Panel");
        await complete_side_panel(page, { mobile: true });
    });

    test("restores the side panel and selected tab when navigating Back", async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto("/");
        await expect(page.locator(tour_target("side-panel"))).toBeHidden();
        await start_tour(page, "Side Panel");

        await open_side_panel(page);
        await expect_tour_step(page, "side_panel_overview", tour_target("side-panel"));
        await back_tour_step(page);
        await expect_tour_step(
            page,
            "side_panel_open_side_panel",
            tour_target("top-bar-right-menu"),
        );
        await expect(page.locator(tour_target("side-panel"))).toBeHidden();
        await page.locator(tour_target("top-bar-right-menu")).locator("button").click();
        await expect_tour_step(page, "side_panel_overview", tour_target("side-panel"));

        await next_tour_step(page);
        await expect_tour_step(page, "side_panel_tabs", tour_target("side-panel-tabs"));
        await next_tour_step(page);
        await expect_tour_step(
            page,
            "side_panel_filters_tab",
            tour_target("side-panel-tab-filters"),
        );
        await next_tour_step(page);
        await expect_tour_step(
            page,
            "side_panel_filters_view",
            tour_target("side-panel-view-filters"),
        );
        await next_tour_step(page);
        await expect_tour_step(
            page,
            "side_panel_band_bar_tab",
            tour_target("side-panel-tab-band-bar"),
        );
        await page.locator(tour_target("side-panel-tab-band-bar")).click();
        await expect_tour_step(page, "side_panel_band_activity", tour_target("band-bar-panel"));

        await back_tour_step(page);
        await expect_tour_step(
            page,
            "side_panel_band_bar_tab",
            tour_target("side-panel-tab-band-bar"),
        );
        await expect(page.locator(tour_target("side-panel-tab-band-bar"))).toHaveAttribute(
            "data-tour-state",
            "active",
        );
        await back_tour_step(page);
        await page.waitForTimeout(300);
        await expect(page.locator(tour_target("side-panel-view-filters"))).toBeVisible();
        await expect_tour_step(
            page,
            "side_panel_filters_view",
            tour_target("side-panel-view-filters"),
        );
        await expect(page.locator(tour_target("side-panel-tab-filters"))).toHaveAttribute(
            "data-tour-state",
            "active",
        );
        await next_tour_step(page);
        await expect_tour_step(
            page,
            "side_panel_band_bar_tab",
            tour_target("side-panel-tab-band-bar"),
        );
        await page.locator(tour_target("side-panel-tab-band-bar")).click();
        await expect_tour_step(page, "side_panel_band_activity", tour_target("band-bar-panel"));
        await page.locator(".react-joyride__tooltip [data-testid='button-close']").click();
        await expect(page.locator(".react-joyride__tooltip")).toBeHidden();
    });
});

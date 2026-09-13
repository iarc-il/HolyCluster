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

function search_input(page, mobile) {
    return page
        .locator(tour_target(mobile ? "table-search-mobile" : "table-search"))
        .locator("input");
}

async function reach_spot_row(page, { mobile = false } = {}) {
    if (mobile) {
        await expect_tour_step(
            page,
            "spots_table_show_the_table",
            tour_target("mobile-main-tab-table"),
        );
        await page.locator(tour_target("mobile-main-tab-table")).click();
        await expect(page.locator(tour_target("spots-table"))).toBeVisible();
    } else {
        await expect_tour_step(page, "spots_table_view", tour_target("table-panel"));
        await next_tour_step(page);
    }

    await expect_tour_step(
        page,
        mobile ? "spots_table_callsign_search_mobile" : "spots_table_callsign_search_desktop",
        tour_target(mobile ? "table-search-mobile" : "table-search"),
    );
    await search_input(page, mobile).fill("JA1XYZ");
    await search_input(page, mobile).press("Enter");
    await expect(search_input(page, mobile)).toHaveValue("");
    await next_tour_step(page);

    const single_spot = page.locator(
        tour_target(
            mobile ? "table-search-mobile-single-spot-toggle" : "table-search-single-spot-toggle",
        ),
    );
    await expect_tour_step(
        page,
        mobile ? "spots_table_single_spot_mode_mobile" : "spots_table_single_spot_mode_desktop",
        tour_target(
            mobile ? "table-search-mobile-single-spot-toggle" : "table-search-single-spot-toggle",
        ),
    );
    await expect_state_change(single_spot, () => single_spot.click());

    const header = page.locator(tour_target("table-header-dx_callsign"));
    await expect_tour_step(
        page,
        "spots_table_columns_and_sorting",
        tour_target("table-header-dx_callsign"),
    );
    await expect_state_change(header, () => header.click());

    const row = page.locator(tour_target("spot-row"));
    await expect_tour_step(page, "spots_table_spot_row", tour_target("spot-row"));
    await expect_state_change(row, () => row.click());
}

async function finish_read_only_table_steps(page, { mobile = false } = {}) {
    await expect_tour_step(page, "spots_table_frequency", tour_target("spot-row-frequency"));
    await next_tour_step(page);

    if (!mobile) {
        await expect_tour_step(page, "spots_table_band", tour_target("spot-row-band"));
        await next_tour_step(page);
    }

    await expect_tour_step(page, "spots_table_mode", tour_target("spot-row-mode"));

    if (!mobile) {
        await next_tour_step(page);
        await expect_tour_step(page, "spots_table_comment", tour_target("spot-row-comment"));
    }

    await finish_tour(page);
}

async function complete_context_menu_steps(page, { mobile = false } = {}) {
    await expect_tour_step(
        page,
        "spots_table_right_click_callsign",
        tour_target("spot-row-dx-callsign"),
    );
    await page.locator(tour_target("spot-row-dx-callsign")).click({ button: "right" });
    await expect_tour_step(page, "spots_table_callsign_actions", tour_target("table-context-menu"));
    await page.keyboard.press("Escape");

    await expect_tour_step(page, "spots_table_right_click_flag", tour_target("spot-row-flag"));
    await page.locator(tour_target("spot-row-flag")).click({ button: "right" });
    await expect_tour_step(page, "spots_table_entity_actions", tour_target("table-context-menu"));
    await page.keyboard.press("Escape");

    await finish_read_only_table_steps(page, { mobile });
}

test.describe("Spots Table tour", () => {
    test("completes every applicable desktop step", async ({ page }) => {
        await page.setViewportSize({ width: 1800, height: 1000 });
        await page.goto("/");
        await expect(page.locator(tour_target("spot-row"))).toBeVisible();

        await start_tour(page, "Spots Table");
        await reach_spot_row(page);
        await complete_context_menu_steps(page);
    });

    test("completes every applicable mobile step", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/");
        await start_tour(page, "Spots Table");
        await reach_spot_row(page, { mobile: true });
        await complete_context_menu_steps(page, { mobile: true });
    });

    test("keeps Joyride Back usable above an open context menu on mobile", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/");
        await start_tour(page, "Spots Table");
        await reach_spot_row(page, { mobile: true });

        await expect_tour_step(
            page,
            "spots_table_right_click_callsign",
            tour_target("spot-row-dx-callsign"),
        );
        await page.locator(tour_target("spot-row-dx-callsign")).click({ button: "right" });
        await expect_tour_step(
            page,
            "spots_table_callsign_actions",
            tour_target("table-context-menu"),
        );
        await expect(page.locator(tour_target("table-context-menu"))).toBeVisible();

        await back_tour_step(page);
        await expect_tour_step(
            page,
            "spots_table_right_click_callsign",
            tour_target("spot-row-dx-callsign"),
        );
        await expect(page.locator(tour_target("table-context-menu"))).toBeHidden();
    });

    test("restores pinned rows and context menus when navigating Back", async ({ page }) => {
        await page.setViewportSize({ width: 1800, height: 1000 });
        await page.goto("/");
        await start_tour(page, "Spots Table");
        await reach_spot_row(page);

        await back_tour_step(page);
        await expect_tour_step(page, "spots_table_spot_row", tour_target("spot-row"));
        await expect(page.locator(tour_target("spot-row"))).toHaveAttribute(
            "data-tour-state",
            "unpinned",
        );
        await page.locator(tour_target("spot-row")).click();
        await expect_tour_step(
            page,
            "spots_table_right_click_callsign",
            tour_target("spot-row-dx-callsign"),
        );

        await page.locator(tour_target("spot-row-dx-callsign")).click({ button: "right" });
        await expect_tour_step(
            page,
            "spots_table_callsign_actions",
            tour_target("table-context-menu"),
        );
        await back_tour_step(page);
        await expect_tour_step(
            page,
            "spots_table_right_click_callsign",
            tour_target("spot-row-dx-callsign"),
        );
        await expect(page.locator(tour_target("table-context-menu"))).toBeHidden();

        await page.locator(tour_target("spot-row-dx-callsign")).click({ button: "right" });
        await expect_tour_step(
            page,
            "spots_table_callsign_actions",
            tour_target("table-context-menu"),
        );
        await page.keyboard.press("Escape");
        await expect_tour_step(page, "spots_table_right_click_flag", tour_target("spot-row-flag"));

        await page.locator(tour_target("spot-row-flag")).click({ button: "right" });
        await expect_tour_step(
            page,
            "spots_table_entity_actions",
            tour_target("table-context-menu"),
        );
        await back_tour_step(page);
        await expect_tour_step(page, "spots_table_right_click_flag", tour_target("spot-row-flag"));
        await expect(page.locator(tour_target("table-context-menu"))).toBeHidden();

        await page.locator(tour_target("spot-row-flag")).click({ button: "right" });
        await expect_tour_step(
            page,
            "spots_table_entity_actions",
            tour_target("table-context-menu"),
        );
        await page.keyboard.press("Escape");
        await finish_read_only_table_steps(page);
    });
});

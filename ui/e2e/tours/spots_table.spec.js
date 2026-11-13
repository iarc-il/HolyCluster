import {
    back_tour_step,
    expect,
    expect_tour_step,
    finish_tour,
    next_tour_step,
    start_tour,
    test,
    tour_spots,
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
    await expect_state_change(row, () => page.locator(tour_target("spot-row-dx-callsign")).click());
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

test.describe("Tuned frequency indicator", () => {
    test.use({ radio_state: { status: "connected", freq: 14_074, mode: "FT8" } });

    for (const width of [1800, 390]) {
        test(`tints the full matching row at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await page.goto("/");
            if (width < 768) {
                await page.locator(tour_target("mobile-main-tab-table")).click();
            }

            const row = page.locator("tbody tr").filter({
                has: page.locator("td:nth-child(3) a", { hasText: /^JA1XYZ$/ }),
            });
            await expect(row).toHaveCount(1);

            const background = await row.evaluate(element => element.style.backgroundColor);
            expect(background).toContain("color-mix");
            expect(background).toContain("60%");
            await expect(row.locator("td:nth-child(4)")).toHaveCSS("box-shadow", "none");
        });
    }
});

test.describe("Spot frequency affordance", () => {
    test("does not show a pointer outside CAT Control", async ({ page }) => {
        await page.goto("/");

        const frequency = page.locator(tour_target("spot-row-frequency"));
        await expect(frequency).toBeVisible();
        await expect(frequency.locator("span.inline-block:visible")).toHaveCSS("cursor", "auto");
    });

    test("pins the row when CAT Control is unavailable", async ({ page }) => {
        await page.goto("/");

        const row = page.locator(tour_target("spot-row"));
        await expect(row).toHaveAttribute("data-tour-state", "unpinned");
        await page.locator(tour_target("spot-row-frequency")).click();
        await expect(row).toHaveAttribute("data-tour-state", "pinned");
    });

    test.describe("with CAT Control", () => {
        test.use({ radio_state: { status: "connected", freq: 14_000_000, mode: "USB" } });

        test("shows a pointer", async ({ page }) => {
            await page.goto("/");

            const frequency = page.locator(tour_target("spot-row-frequency"));
            await expect(frequency).toBeVisible();
            await expect(frequency.locator("span.inline-block:visible")).toHaveCSS(
                "cursor",
                "pointer",
            );
        });
    });
});

test.describe("Spot frequency selection", () => {
    test.use({ radio_state: { status: "connected", freq: 14_000_000, mode: "USB" } });

    test("tunes and notifies logger integration without pinning", async ({
        page,
        radio_requests,
    }) => {
        await page.setViewportSize({ width: 1800, height: 1000 });
        await page.goto("/");

        const row = page.locator(tour_target("spot-row"));
        await expect(row).toBeVisible();
        await expect(row).toHaveAttribute("data-tour-state", "unpinned");
        const dx_callsign = (
            await row.locator(tour_target("spot-row-dx-callsign")).getByRole("link").textContent()
        ).trim();
        const selected_spot = tour_spots.find(spot => spot.dx_callsign === dx_callsign);
        expect(selected_spot).toBeTruthy();

        await page.locator(tour_target("spot-row-frequency")).click();

        await expect
            .poll(() => radio_requests.filter(request => request.action === "SetModeAndFreq"))
            .toEqual([
                expect.objectContaining({
                    mode: selected_spot.mode,
                    freq: selected_spot.freq,
                }),
            ]);
        await expect
            .poll(() => radio_requests.filter(request => request.action === "HighlightSpot"))
            .toEqual([
                expect.objectContaining({
                    dx_callsign: selected_spot.dx_callsign,
                    freq: Math.round(selected_spot.freq * 1000),
                    mode: selected_spot.mode,
                    udp_port: 2237,
                }),
            ]);
        await expect(row).toHaveAttribute("data-tour-state", "unpinned");
    });
});

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

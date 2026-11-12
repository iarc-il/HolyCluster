import { expect, test, tour_target } from "./fixtures/tour.js";

const empty_state = page => page.locator(tour_target("spots-empty-state"));

async function open_table(page) {
    await page.setViewportSize({ width: 1800, height: 900 });
    await page.goto("/");
    await expect(page.locator(tour_target("spot-row"))).toBeVisible();
}

test("explains when disabled bands and modes hide every spot", async ({ page }) => {
    await open_table(page);
    await page.evaluate(() => {
        const store = JSON.parse(localStorage.getItem("profiles_missing"));
        const profile =
            store.profiles.find(item => item.name === store.active_profile_name) ??
            store.profiles[0];
        profile.data.settings.disabled_bands = Object.fromEntries(
            Object.keys(profile.data.settings.disabled_bands).map(band => [band, true]),
        );
        profile.data.settings.disabled_modes = Object.fromEntries(
            Object.keys(profile.data.settings.disabled_modes).map(mode => [mode, true]),
        );
        localStorage.setItem("profiles_missing", JSON.stringify(store));
    });
    await page.reload();

    await expect(empty_state(page)).toContainText("No spots");
    await expect(empty_state(page)).toContainText("Hidden by disabled bands and modes");
});

test("identifies table controls that hide spots", async ({ page }) => {
    await open_table(page);

    await page.locator(tour_target("table-search")).locator("input").fill("NOTREAL");
    await expect(empty_state(page)).toContainText("Hidden by search");

    await page.locator(tour_target("table-search")).locator("input").fill("");
    await expect(empty_state(page)).toBeHidden();
    await expect(page.locator(tour_target("spot-row"))).toBeVisible();

    for (const mode of ["SSB", "CW", "FT8", "FT4", "DIGI", "RTTY"]) {
        await page.locator(tour_target(`mode-filter-${mode}`)).click();
    }
    await expect(empty_state(page)).toContainText("Hidden by mode filters");
});

test("identifies saved show-only and continent filters", async ({ page }) => {
    await open_table(page);
    await page.evaluate(() => {
        const store = JSON.parse(localStorage.getItem("profiles_missing"));
        const profile =
            store.profiles.find(item => item.name === store.active_profile_name) ??
            store.profiles[0];
        profile.data.callsign_filters.filters = [
            { action: "show_only", type: "prefix", value: "NOTREAL", spotter_or_dx: "dx" },
        ];
        localStorage.setItem("profiles_missing", JSON.stringify(store));
    });
    await page.reload();
    await expect(empty_state(page)).toContainText("Hidden by show-only filters");

    await page.evaluate(() => {
        const store = JSON.parse(localStorage.getItem("profiles_missing"));
        const profile =
            store.profiles.find(item => item.name === store.active_profile_name) ??
            store.profiles[0];
        profile.data.callsign_filters.filters = [];
        profile.data.filters.dx_continents = Object.fromEntries(
            Object.keys(profile.data.filters.dx_continents).map(continent => [continent, false]),
        );
        localStorage.setItem("profiles_missing", JSON.stringify(store));
    });
    await page.reload();
    await expect(empty_state(page)).toContainText("Hidden by DX continent filters");
});

test("shows the filter cause in the mobile table", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.locator(tour_target("mobile-main-tab-table")).click();
    await expect(page.locator(tour_target("spot-row"))).toBeVisible();

    await page.locator(tour_target("table-search-mobile")).locator("input").fill("NOTREAL");

    await expect(empty_state(page)).toContainText("Hidden by search");
});

test("distinguishes an empty reference source from filtering", async ({ page }) => {
    await open_table(page);

    await page.locator(tour_target("table-search-reference-selector")).selectOption("pota");

    await expect(empty_state(page)).toContainText("No POTA spots received");
    await expect(empty_state(page)).not.toContainText("Hidden by");
});

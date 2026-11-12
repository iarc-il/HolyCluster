import { expect, test, tour_target } from "./fixtures/tour.js";

const empty_state = page => page.locator(tour_target("spots-empty-state"));
const reason = (page, name) => page.locator(tour_target(`spots-empty-reason-${name}`));

async function open_table(page) {
    await page.setViewportSize({ width: 1800, height: 900 });
    await page.goto("/");
    await expect(page.locator(tour_target("spot-row"))).toBeVisible();
}

async function update_profile(page, changes) {
    await page.evaluate(changes => {
        const store = JSON.parse(localStorage.getItem("profiles_missing"));
        const profile =
            store.profiles.find(item => item.name === store.active_profile_name) ??
            store.profiles[0];
        const { filters, callsign_filters, settings } = profile.data;

        if (changes.bands_active != null) {
            filters.bands = Object.fromEntries(
                Object.keys(filters.bands).map(band => [band, changes.bands_active]),
            );
        }
        if (changes.modes_active != null) {
            filters.modes = Object.fromEntries(
                Object.keys(filters.modes).map(mode => [mode, changes.modes_active]),
            );
        }
        if (changes.ssb_active != null) filters.modes.SSB = changes.ssb_active;
        if (changes.dx_continents_active != null) {
            filters.dx_continents = Object.fromEntries(
                Object.keys(filters.dx_continents).map(continent => [
                    continent,
                    changes.dx_continents_active,
                ]),
            );
        }
        if (changes.show_only_filter) {
            callsign_filters.filters = [changes.show_only_filter];
        }
        if (changes.disabled_bands != null) {
            settings.disabled_bands = Object.fromEntries(
                Object.keys(settings.disabled_bands).map(band => [band, changes.disabled_bands]),
            );
        }
        localStorage.setItem("profiles_missing", JSON.stringify(store));
    }, changes);
    await page.reload();
}

test("only shows filters whose repair can reveal spots", async ({ page }) => {
    await open_table(page);
    await update_profile(page, { bands_active: false, ssb_active: false });

    await expect(reason(page, "bands")).toContainText("Band filters");
    await expect(reason(page, "modes")).toHaveCount(0);

    await reason(page, "bands").getByRole("button", { name: "Enable all" }).click();
    await expect(empty_state(page)).toBeHidden();
    await expect(page.locator(tour_target("spot-row"))).toBeVisible();
});

test("shows a smallest combined repair as separate rows", async ({ page }) => {
    await open_table(page);
    await update_profile(page, { bands_active: false, modes_active: false });

    await expect(reason(page, "bands")).toBeVisible();
    await expect(reason(page, "modes")).toBeVisible();

    await reason(page, "bands").getByRole("button", { name: "Enable all" }).click();
    await expect(empty_state(page)).toBeVisible();
    await expect(reason(page, "bands")).toHaveCount(0);
    await expect(reason(page, "modes")).toBeVisible();

    await reason(page, "modes").getByRole("button", { name: "Enable all" }).click();
    await expect(empty_state(page)).toBeHidden();
    await expect(page.locator(tour_target("spot-row"))).toBeVisible();
});

test("repairs show-only and continent filters", async ({ page }) => {
    await open_table(page);
    await update_profile(page, {
        show_only_filter: {
            action: "show_only",
            type: "prefix",
            value: "NOTREAL",
            spotter_or_dx: "dx",
        },
    });

    await reason(page, "show_only").getByRole("button", { name: "Turn off" }).click();
    await expect(page.locator(tour_target("spot-row"))).toBeVisible();

    await update_profile(page, { dx_continents_active: false });
    await reason(page, "dx_continents").getByRole("button", { name: "Enable all" }).click();
    await expect(page.locator(tour_target("spot-row"))).toBeVisible();
});

test("does not show skipped causes", async ({ page }) => {
    await open_table(page);

    await page.locator(tour_target("table-search")).locator("input").fill("NOTREAL");
    await expect(empty_state(page)).toContainText("No spots");
    await expect(empty_state(page).getByRole("button")).toHaveCount(0);

    await page.locator(tour_target("table-search")).locator("input").fill("");
    await update_profile(page, { disabled_bands: true });
    await expect(empty_state(page)).toContainText("No spots");
    await expect(empty_state(page).getByRole("button")).toHaveCount(0);
});

test("shows repair actions in the mobile table", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await update_profile(page, { modes_active: false });
    await page.locator(tour_target("mobile-main-tab-table")).click();

    await expect(reason(page, "modes")).toBeVisible();
    await reason(page, "modes").getByRole("button", { name: "Enable all" }).click();
    await expect(page.locator(tour_target("spot-row"))).toBeVisible();
});

test("distinguishes an empty reference source from filtering", async ({ page }) => {
    await open_table(page);

    await page.locator(tour_target("table-search-reference-selector")).selectOption("pota");

    await expect(empty_state(page)).toContainText("No POTA spots received");
    await expect(empty_state(page).getByRole("button")).toHaveCount(0);
});

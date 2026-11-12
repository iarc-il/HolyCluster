import { expect, tour_spots, test as tour_test } from "./fixtures/tour.js";

const frequency_spots = tour_spots.map(spot => ({ ...spot, freq: spot.freq * 1000 }));
const test = tour_test.extend({
    tour_spots: async ({}, use) => {
        await use(frequency_spots);
    },
});

async function read_scroll_calls(page) {
    return page.evaluate(() => window.__spot_table_scroll_calls);
}

test.use({ radio_state: { status: "connected", freq: 14_074, mode: "FT8" } });

test("scrolls the spots table on band-bar hover unless a spot is pinned", async ({ page }) => {
    await page.addInitScript(() => {
        window.__spot_table_scroll_calls = [];
        Element.prototype.scrollIntoView = function (options) {
            window.__spot_table_scroll_calls.push({ spot_id: this.dataset.spotId, options });
        };
    });

    await page.setViewportSize({ width: 1800, height: 1000 });
    await page.goto("/");
    await page.locator('[data-tour="side-panel-tab-band-bar"]').click();
    await page.locator('[data-tour="band-bar-band-select"]').selectOption("20");
    const band_bar_spot = page.locator('[data-tour="band-bar-spot"]').first();
    const spot_id = await band_bar_spot.getAttribute("data-spot-id");
    await band_bar_spot.locator("line").first().hover();

    await expect
        .poll(() => read_scroll_calls(page))
        .toEqual([
            {
                spot_id,
                options: { behavior: "instant", block: "center" },
            },
        ]);

    const table_row = page.locator(`tbody [data-spot-id="${spot_id}"]`);
    await table_row.click();
    await expect(table_row).toHaveAttribute("data-pinned", "true");
    await page.evaluate(() => {
        window.__spot_table_scroll_calls = [];
    });

    const other_spot = page.locator('[data-tour="band-bar-spot"]').nth(1);
    await other_spot.locator("line").first().hover();
    await expect(other_spot.locator("rect")).toHaveCount(1);
    expect(await read_scroll_calls(page)).toEqual([]);
});

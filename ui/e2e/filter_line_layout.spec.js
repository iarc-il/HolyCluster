import { expect, test } from "@playwright/test";

const FILTER_CASES = [
    { name: "prefix", filter: { type: "prefix", value: "K", spotter_or_dx: "dx" } },
    { name: "suffix", filter: { type: "suffix", value: "XYZ", spotter_or_dx: "dx" } },
    { name: "entity", filter: { type: "entity", value: 291, spotter_or_dx: "dx" } },
    { name: "CQ zone", filter: { type: "zone", zone_system: "cq", value: 40 } },
    { name: "ITU zone", filter: { type: "zone", zone_system: "itu", value: 90 } },
    { name: "US state", filter: { type: "zone", zone_system: "us_state", value: "DC" } },
    {
        name: "Canadian province",
        filter: { type: "zone", zone_system: "ca_province", value: "NL" },
    },
    { name: "comment", filter: { type: "comment", value: "portable activation" } },
    { name: "LoTW", filter: { type: "lotw" } },
    { name: "missing DXCC", filter: { type: "missing", missing_section: "dxcc" } },
    { name: "missing CQ", filter: { type: "missing", missing_section: "cq_zone" } },
    { name: "missing ITU", filter: { type: "missing", missing_section: "itu_zone" } },
    { name: "missing US", filter: { type: "missing", missing_section: "us_state" } },
    {
        name: "missing Canada",
        filter: { type: "missing", missing_section: "ca_province" },
    },
    { name: "self spotters", filter: { type: "self_spotters" } },
    { name: "DXpeditions", filter: { type: "dxpeditions" } },
];

function rectangles_overlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

test("filter content does not overlap its edit button", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/");
    await page.evaluate(filter_cases => {
        const store = JSON.parse(localStorage.getItem("profiles_missing"));
        const profile =
            store.profiles.find(item => item.name === store.active_profile_name) ??
            store.profiles[0];
        profile.data.callsign_filters.filters = filter_cases.map(({ filter }) => ({
            action: "alert",
            ...filter,
        }));
        localStorage.setItem("profiles_missing", JSON.stringify(store));
        localStorage.setItem("first_launch", JSON.stringify(false));
    }, FILTER_CASES);
    await page.reload();
    await page.locator('[data-tour="top-bar-right-menu"] button').click();
    await page.locator('[data-tour="side-panel-tab-filters"]').click();
    await expect(page.locator('[data-tour="filters-panel"]')).toBeVisible();

    const handles = page.getByRole("button", { name: "Move filter" });
    await expect(handles).toHaveCount(FILTER_CASES.length);

    const overlaps = [];
    for (const width of [768, 1024, 1535]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));

        for (const [index, filter_case] of FILTER_CASES.entries()) {
            const row = handles.nth(index).locator("xpath=..");
            const content = row.locator(":scope > div").first();
            const edit_button = row.locator('[data-tour="edit-filter-button"]');
            const content_rects = await content.locator(":scope > *").evaluateAll(elements =>
                elements.map(element => {
                    const rect = element.getBoundingClientRect();
                    return {
                        left: rect.left,
                        right: rect.right,
                        top: rect.top,
                        bottom: rect.bottom,
                    };
                }),
            );
            const edit_rect = await edit_button.evaluate(element => {
                const rect = element.getBoundingClientRect();
                return {
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                };
            });

            if (content_rects.some(rect => rectangles_overlap(rect, edit_rect))) {
                overlaps.push({ width, filter: filter_case.name });
            }
        }
    }

    expect(overlaps, "Filter types whose rendered content overlaps the edit button").toEqual([]);
});

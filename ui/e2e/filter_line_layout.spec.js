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

async function open_desktop_filters(page, filter_cases) {
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
    }, filter_cases);
    await page.reload();
    await page.locator('[data-tour="top-bar-right-menu"] button').click();
    await page.locator('[data-tour="side-panel-tab-filters"]').click();
    await expect(page.locator('[data-tour="filters-panel"]')).toBeVisible();
}

test("filter content does not overlap its edit button", async ({ page }) => {
    await open_desktop_filters(page, FILTER_CASES);

    const handles = page.getByRole("button", { name: "Move filter" });
    await expect(handles).toHaveCount(FILTER_CASES.length);

    const overlaps = [];
    for (const width of [768, 1024, 1535]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));

        const overlapping_filters = await handles.evaluateAll((handle_elements, filter_cases) => {
            return handle_elements.flatMap((handle, index) => {
                const row = handle.parentElement;
                const content = row?.querySelector(":scope > div");
                const edit_button = row?.querySelector('[data-tour="edit-filter-button"]');
                if (!content || !edit_button) return [];

                const edit_rect = edit_button.getBoundingClientRect();
                const has_overlap = [...content.children].some(element => {
                    const content_rect = element.getBoundingClientRect();
                    return (
                        content_rect.left < edit_rect.right &&
                        content_rect.right > edit_rect.left &&
                        content_rect.top < edit_rect.bottom &&
                        content_rect.bottom > edit_rect.top
                    );
                });

                return has_overlap ? [filter_cases[index].name] : [];
            });
        }, FILTER_CASES);
        overlaps.push(...overlapping_filters.map(filter => ({ width, filter })));
    }

    expect(overlaps, "Filter types whose rendered content overlaps the edit button").toEqual([]);
});

test("dragging a filter does not add horizontal scrolling", async ({ page }) => {
    await open_desktop_filters(page, [FILTER_CASES.find(item => item.name === "self spotters")]);

    const scroller = page.locator('[data-tour="side-panel-view-filters"]');
    const handle = page.getByRole("button", { name: "Move filter" });
    const target = page.locator('[data-tour="filter-section-show_only"]');
    const handle_box = await handle.boundingBox();
    const target_box = await target.boundingBox();
    expect(handle_box).not.toBeNull();
    expect(target_box).not.toBeNull();

    await page.mouse.move(
        handle_box.x + handle_box.width / 2,
        handle_box.y + handle_box.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
        target_box.x + target_box.width / 2,
        target_box.y + target_box.height / 2,
        { steps: 8 },
    );
    await expect(target.locator('[data-tour="filter-drop-placeholder"]')).toBeVisible();

    const dimensions = await scroller.evaluate(element => ({
        client_width: element.clientWidth,
        scroll_width: element.scrollWidth,
    }));
    expect(dimensions.scroll_width).toBe(dimensions.client_width);

    await page.mouse.up();
});

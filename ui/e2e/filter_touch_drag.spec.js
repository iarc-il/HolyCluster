import { expect, test } from "@playwright/test";

test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
});

test("moves a custom filter with touch", async ({ context, page }) => {
    await page.goto("/");
    await page.evaluate(() => {
        const store = JSON.parse(localStorage.getItem("profiles_missing"));
        const profile =
            store.profiles.find(item => item.name === store.active_profile_name) ??
            store.profiles[0];
        profile.data.callsign_filters.filters = [
            { action: "alert", type: "prefix", spotter_or_dx: "dx", value: "K" },
        ];
        localStorage.setItem("profiles_missing", JSON.stringify(store));
        localStorage.setItem("first_launch", JSON.stringify(false));
    });
    await page.reload();
    await page.locator('[data-tour="mobile-main-tab-filters"]').click();
    await page.getByRole("button", { name: "Custom filters", exact: true }).click();

    const source = page.locator('[data-tour="filter-line-alert"]');
    const target = page.locator('[data-tour="filter-section-show_only"]');
    await expect(source).toBeVisible();
    await expect(source).toHaveRole("button", { name: "Move filter" });
    await expect(source).toHaveCSS("touch-action", "none");

    const source_box = await source.boundingBox();
    const target_box = await target.boundingBox();
    expect(source_box).not.toBeNull();
    expect(target_box).not.toBeNull();

    const client = await context.newCDPSession(page);
    const start = {
        x: source_box.x + source_box.width / 2,
        y: source_box.y + source_box.height / 2,
    };
    const end = {
        x: target_box.x + target_box.width / 2,
        y: target_box.y + Math.min(target_box.height / 2, 70),
    };

    await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ ...start, id: 1 }],
    });
    for (let step = 1; step <= 12; step += 1) {
        const progress = step / 12;
        await client.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [
                {
                    x: start.x + (end.x - start.x) * progress,
                    y: start.y + (end.y - start.y) * progress,
                    id: 1,
                },
            ],
        });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    await expect(target).toHaveAttribute("data-tour-state", "1");
});

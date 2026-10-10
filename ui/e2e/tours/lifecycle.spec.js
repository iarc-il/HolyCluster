import {
    close_tour,
    expect,
    expect_tour_step,
    next_tour_step,
    skip_tour,
    start_tour,
    test,
    tour_target,
} from "../fixtures/tour.js";

test.describe("First launch", () => {
    test.use({ viewport: { width: 1280, height: 900 }, auto_start_tour: true });

    test("starts Quick Start automatically", async ({ page }) => {
        await page.goto("/");
        await expect_tour_step(page, "quick_start_welcome", tour_target("top-bar"));
        await expect
            .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("first_launch"))))
            .toBe(false);
        await close_tour(page);
    });
});

test.describe("Tour profile cleanup", () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    async function change_time_limit(page) {
        await expect_tour_step(page, "quick_start_welcome", tour_target("top-bar"));
        await next_tour_step(page);
        const time_limit = page.locator(tour_target("top-bar-time-limit"));
        await time_limit.selectOption("900");
        await expect(time_limit).toHaveValue("900");
        return time_limit;
    }

    test("restores the persisted profile when a tour is closed", async ({ page }) => {
        await page.goto("/");
        await start_tour(page, "Quick Start");
        const time_limit = await change_time_limit(page);

        await close_tour(page);
        await expect(time_limit).toHaveValue("3600");
        await expect
            .poll(() => page.evaluate(() => localStorage.getItem("profiles") ?? ""))
            .not.toContain('"Tour"');
    });

    test("restores the persisted profile when a tour is skipped", async ({ page }) => {
        await page.goto("/");
        await start_tour(page, "Quick Start");
        const time_limit = await change_time_limit(page);

        await skip_tour(page);
        await expect(time_limit).toHaveValue("3600");
        await expect
            .poll(() => page.evaluate(() => localStorage.getItem("profiles") ?? ""))
            .not.toContain('"Tour"');
    });
});

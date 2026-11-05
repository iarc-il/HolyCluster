import { expect, test, tour_target } from "./fixtures/tour.js";

test.use({ viewport: { width: 390, height: 844 } });

test("mobile Layout settings apply all Map and Table choices without overflow", async ({
    page,
}) => {
    await page.goto("/");
    const dialog = page.locator(tour_target("settings-modal"));
    const options = [
        { value: "map", title: "Map only", tabs: ["Map"] },
        { value: "table", title: "Table only", tabs: ["Table"] },
        { value: "map_table", title: "Map + Table", tabs: ["Map", "Table"] },
        { value: "table_map", title: "Table + Map", tabs: ["Table", "Map"] },
    ];

    for (const option of options) {
        await page.locator(tour_target("top-bar-settings")).click();
        const layout_tab = dialog.getByRole("button", { name: "Layout", exact: true });
        await expect(layout_tab).toBeVisible();
        await layout_tab.click();
        const card = dialog.locator(tour_target(`settings-layout-${option.value}`));
        await expect(card).toContainText(option.title);
        await card.click();
        await expect(card).toHaveAttribute("aria-pressed", "true");
        await expect(dialog.locator("button[aria-pressed='true']")).toHaveCount(2);

        const bounds = await dialog.evaluate(element => {
            const content = element.querySelector("[data-tour='settings-modal-content']");
            const rect = content.getBoundingClientRect();
            return {
                left: rect.left,
                right: rect.right,
                viewport: window.innerWidth,
                dialog_overflow: element.scrollWidth - element.clientWidth,
                content_overflow: content.scrollWidth - content.clientWidth,
            };
        });
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
        expect(bounds.dialog_overflow).toBeLessThanOrEqual(1);
        expect(bounds.content_overflow).toBeLessThanOrEqual(1);
        for (const choice of options) {
            const box = await dialog
                .locator(tour_target(`settings-layout-${choice.value}`))
                .boundingBox();
            expect(box.x).toBeGreaterThanOrEqual(bounds.left);
            expect(box.x + box.width).toBeLessThanOrEqual(bounds.right);
        }

        await dialog.getByRole("button", { name: "Apply", exact: true }).click();
        await expect(dialog).toBeHidden();
        const tabs = page.locator(`${tour_target("mobile-main-tabs-tabs")} button`);
        await expect(tabs).toHaveText(option.tabs);
        for (const tab of option.tabs) {
            const button = tabs.filter({ hasText: tab });
            await button.click();
            await expect(button).toHaveAttribute("aria-pressed", "true");
            await expect(
                page.locator(tour_target(tab === "Map" ? "map-controls" : "spots-table")),
            ).toBeVisible();
        }

        await page.locator(tour_target("top-bar-settings")).click();
        await dialog.getByRole("button", { name: "Layout", exact: true }).click();
        await expect(
            dialog.locator(tour_target(`settings-layout-${option.value}`)),
        ).toHaveAttribute("aria-pressed", "true");
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    }
});

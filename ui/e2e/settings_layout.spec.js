import { expect, test, tour_target } from "./fixtures/tour.js";

for (const width of [390, 500]) {
    test.describe(`Mobile layout at ${width}px`, () => {
        test.use({ viewport: { width, height: 844 } });

        test("mobile Layout settings apply all Map and Table choices without overflow", async ({
            page,
        }) => {
            await page.goto("/");
            const dialog = page.locator(tour_target("settings-modal"));
            const options = [
                { value: "map", title: "Map only", tabs: ["Map"] },
                { value: "table", title: "Spots only", tabs: ["Spots"] },
                { value: "map_table", title: "Map + Spots", tabs: ["Map", "Spots"] },
                { value: "table_map", title: "Spots + Map", tabs: ["Spots", "Map"] },
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
                const tabs = page.locator(
                    `${tour_target("mobile-main-tabs")} button[aria-pressed]`,
                );
                await expect(tabs).toHaveText([...option.tabs, "Filters", "Tools"]);
                await expect(
                    page.getByRole("navigation", { name: "Workspace" }).getByRole("button"),
                ).toHaveText([...option.tabs, "Filters", "Tools"]);
                for (const tab of option.tabs) {
                    const button = tabs.filter({ hasText: tab });
                    await button.click();
                    await expect(button).toHaveAttribute("aria-pressed", "true");
                    await expect(
                        page.locator(tour_target(tab === "Map" ? "map-controls" : "spots-table")),
                    ).toBeVisible();
                }

                for (const name of ["Filters", "Tools"]) {
                    const tab = page
                        .getByRole("navigation", { name: "Workspace" })
                        .getByRole("button", { name, exact: true });
                    await tab.click();
                    await expect(tab).toHaveAttribute("aria-pressed", "true");
                }
                await page.locator(tour_target("top-bar-settings")).click();
                await dialog.getByRole("button", { name: "Layout", exact: true }).click();
                await expect(
                    dialog.locator(tour_target(`settings-layout-${option.value}`)),
                ).toHaveAttribute("aria-pressed", "true");
                await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
            }
        });

        async function apply_layout(page, layout) {
            await page.locator(tour_target("top-bar-settings")).click();
            const dialog = page.locator(tour_target("settings-modal"));
            await dialog.getByRole("button", { name: "Layout", exact: true }).click();
            await dialog.locator(tour_target(`settings-layout-${layout}`)).click();
            await dialog.getByRole("button", { name: "Apply", exact: true }).click();
            await expect(dialog).toBeHidden();
        }

        async function expect_workspace(page, selected, order) {
            const nav = page.getByRole("navigation", { name: "Workspace" });
            await expect(nav.getByRole("button")).toHaveText([...order, "Filters", "Tools"]);
            await expect(nav.getByRole("button", { name: selected, exact: true })).toHaveAttribute(
                "aria-pressed",
                "true",
            );
            await expect(
                page.locator(tour_target(selected === "Map" ? "map-controls" : "spots-table")),
            ).toBeVisible();
        }

        test("mobile Table selection survives layout reorder", async ({ page }) => {
            await page.goto("/");
            await apply_layout(page, "map_table");
            await page
                .getByRole("navigation", { name: "Workspace" })
                .getByRole("button", {
                    name: "Spots",
                    exact: true,
                })
                .click();
            await apply_layout(page, "table_map");
            await expect_workspace(page, "Spots", ["Spots", "Map"]);
            await apply_layout(page, "map_table");
            await expect_workspace(page, "Spots", ["Map", "Spots"]);
        });

        for (const [preferred, temporary, single_layout] of [
            ["Spots", "Map", "map"],
            ["Map", "Spots", "table"],
        ]) {
            test(`mobile ${preferred} preference survives ${temporary} only layout`, async ({
                page,
            }) => {
                await page.goto("/");
                await apply_layout(page, "map_table");
                await page
                    .getByRole("navigation", { name: "Workspace" })
                    .getByRole("button", {
                        name: preferred,
                        exact: true,
                    })
                    .click();
                await apply_layout(page, single_layout);
                await expect_workspace(page, temporary, [temporary]);
                expect(
                    await page.evaluate(() => JSON.parse(localStorage.getItem("mobile_panel"))),
                ).toBe(preferred === "Spots" ? "table" : "map");
                await apply_layout(page, "map_table");
                await expect_workspace(page, preferred, ["Map", "Spots"]);
            });
        }

        test("desktop layout changes do not write a mobile preference", async ({ page }) => {
            await page.setViewportSize({ width: 1280, height: 900 });
            await page.goto("/");
            await page.evaluate(() => localStorage.setItem("mobile_tab", "1"));
            for (const layout of ["table_map", "map", "table", "map_table"]) {
                await apply_layout(page, layout);
                expect(await page.evaluate(() => localStorage.getItem("mobile_panel"))).toBeNull();
                expect(await page.evaluate(() => localStorage.getItem("mobile_tab"))).toBe("1");
            }
            await page.setViewportSize({ width, height: 844 });
            await expect_workspace(page, "Map", ["Map", "Spots"]);
            expect(await page.evaluate(() => localStorage.getItem("mobile_panel"))).toBeNull();
        });
    });
}

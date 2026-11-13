import { expect, test } from "./fixtures/tour.js";

for (const width of [768, 1280, 1440, 1535]) {
    test(`compact cockpit at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        const filters = page.getByRole("button", { name: "Open Filters", exact: true });
        const tools = page.getByRole("button", { name: "Open Tools", exact: true });
        const left = page.locator('[data-tour="left-column"]');
        const right = page.locator('[data-tour="side-panel"]');
        const scrim = page.getByRole("button", { name: /^Close (Filters|Tools) overlay$/ });
        await expect(filters).toBeVisible();
        await expect(tools).toBeVisible();
        await expect(left).toBeHidden();
        await expect(right).toBeHidden();
        await expect(scrim).toBeHidden();
        await expect(page.locator('[data-tour="map-panel"]')).toBeVisible();
        await expect(page.locator('[data-tour="table-panel"]')).toBeVisible();

        await filters.click();
        await expect(left).toBeVisible();
        await expect(right).toBeHidden();
        await expect(scrim).toBeVisible();
        await expect(page.locator('[data-tour="top-bar-left-menu"] button')).toHaveAttribute(
            "aria-expanded",
            "true",
        );
        await expect(page.locator('[data-tour="top-bar-left-menu"] button')).toHaveAccessibleName(
            "Close Filters",
        );
        await expect(left.getByRole("button", { name: "Close Filters" })).toBeFocused();
        await tools.click();
        await expect(left).toBeHidden();
        await expect(right).toBeVisible();
        await expect(page.locator('[data-tour="top-bar-right-menu"] button')).toHaveAccessibleName(
            "Close Tools",
        );
        await expect(filters).toHaveAttribute("aria-expanded", "false");
        await right.getByRole("button", { name: "Close Tools" }).click();
        await expect(right).toBeHidden();
        await expect(tools).toBeFocused();
        await expect(scrim).toBeHidden();

        await filters.click();
        await page.keyboard.press("Escape");
        await expect(left).toBeHidden();
        await expect(filters).toBeFocused();
        await tools.click();
        await scrim.click({ position: { x: 200, y: 200 } });
        await expect(right).toBeHidden();
        await expect(tools).toBeFocused();
        await filters.click();
        await left.getByRole("button", { name: "Close Filters" }).click();
        await expect(filters).toBeFocused();
    });
}

for (const width of [768]) {
    test(`compact top bar fits at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        await expect(page.locator('[data-tour="top-bar"]')).toBeVisible();
        await expect
            .poll(() =>
                page.evaluate(() =>
                    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
                ),
            )
            .toBeLessThanOrEqual(width);
        for (const label of ["Filters", "Tools"]) {
            const button = page.getByRole("button", { name: `Open ${label}`, exact: true });
            await expect(button).toBeVisible();
            const text = button.locator("span");
            await expect(text).toBeHidden();
            await expect(button.locator("svg")).toBeVisible();
            const box = await button.boundingBox();
            expect(box.width).toBeGreaterThanOrEqual(40);
            expect(box.height).toBeGreaterThanOrEqual(40);
        }
    });
}

for (const width of [1536, 1800]) {
    test(`persistent cockpit at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        await expect(page.locator('[data-tour="left-column"]')).toBeVisible();
        await expect(page.locator('[data-tour="side-panel"]')).toBeVisible();
        await expect(
            page.getByRole("button", { name: /^(Open|Close) (Filters|Tools)$/ }),
        ).toHaveCount(0);
        await expect(
            page.getByRole("button", { name: /^Close (Filters|Tools) overlay$/ }),
        ).toHaveCount(0);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.getByRole("button", { name: "Open Tools", exact: true }).click();
        await page.setViewportSize({ width, height: 900 });
        await expect(page.locator('[data-tour="left-column"]')).toBeVisible();
        await expect(page.locator('[data-tour="side-panel"]')).toBeVisible();
        await expect(
            page.getByRole("button", { name: /^Close (Filters|Tools) overlay$/ }),
        ).toHaveCount(0);
        await page.setViewportSize({ width: 1280, height: 900 });
        await expect(page.locator('[data-tour="side-panel"]')).toBeHidden();
    });
}

for (const width of [768]) {
    test(`Escape closes a drawer modal first at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        const tools = page.getByRole("button", { name: "Open Tools", exact: true });
        const drawer = page.locator('[data-tour="side-panel"]');
        await tools.click();
        await drawer.locator('[data-tour="add-filter-button-show_only"]').click();
        const modal = page.getByRole("dialog");
        await expect(modal).toBeVisible();
        await expect(modal).toHaveAttribute("aria-modal", "true");
        await page.keyboard.press("Escape");
        await expect(modal).toBeHidden();
        await expect(drawer).toBeVisible();
        await expect(page.locator('[data-tour="top-bar-right-menu"] button')).toHaveAttribute(
            "aria-expanded",
            "true",
        );
        await page.keyboard.press("Escape");
        await expect(drawer).toBeHidden();
        await expect(tools).toBeFocused();
    });
}

test.describe("configured radio", () => {
    test.use({ radio_state: { status: "connected", freq: 14074000, mode: "USB" } });

    for (const width of [390, 500, 768, 800]) {
        test(`radio state fits at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await page.goto("/");
            await page.evaluate(() => {
                const event = new Event("beforeinstallprompt", { cancelable: true });
                Object.assign(event, {
                    prompt: () => Promise.resolve(),
                    userChoice: Promise.resolve({ outcome: "dismissed" }),
                });
                window.dispatchEvent(event);
            });
            await expect(page.getByRole("button", { name: "Install HolyCluster" })).toBeVisible();
            const frequency = page.locator('[data-tour="top-bar-radio-frequency"]');
            await expect(frequency).toBeVisible();
            await expect(frequency.getByText("Radio connected", { exact: true })).toBeVisible();
            await expect(frequency.getByText("14.074 MHz", { exact: true })).toBeVisible();
            if (width >= 768) {
                await expect(frequency.locator('[data-tour="radio-full-frequency"]')).toBeHidden();
                for (const label of ["Filters", "Tools"]) {
                    const button = page.getByRole("button", {
                        name: `Open ${label}`,
                        exact: true,
                    });
                    await expect(button.locator("span")).toBeHidden();
                    await expect(button.locator("svg")).toBeVisible();
                }
            }
            await expect
                .poll(() =>
                    page.evaluate(() =>
                        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
                    ),
                )
                .toBeLessThanOrEqual(width);
        });
    }
});

test.describe("disconnected radio", () => {
    test.use({ radio_state: { status: "disconnected", freq: 14074000, mode: "USB" } });

    for (const width of [390, 500]) {
        test(`radio disconnect is clear at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await page.goto("/");
            const frequency = page.locator('[data-tour="top-bar-radio-frequency"]');
            await expect(frequency.getByText("Radio disconnected", { exact: true })).toBeVisible();
            await expect(frequency.getByText("14.074 MHz", { exact: true })).toBeHidden();
            await expect
                .poll(() =>
                    page.evaluate(() =>
                        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
                    ),
                )
                .toBeLessThanOrEqual(width);
        });
    }
});

test("mobile quick-filter buttons match desktop height", async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 900 });
    await page.goto("/");
    const filter = page.locator('[data-tour="band-filter-20"]');
    const desktop_bounds = await filter.boundingBox();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    const mobile_bounds = await filter.boundingBox();

    expect(mobile_bounds.height).toBeCloseTo(desktop_bounds.height, 0);
});

test("mobile quick-filter separators match", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "Filters", exact: true }).click();

    const separators = await page.evaluate(() => {
        const bands = getComputedStyle(document.querySelector('[data-tour="band-filter-group"]'));
        const continents = getComputedStyle(
            document.querySelector('[data-tour="continent-filter-header"]'),
        );
        return {
            bands: [bands.borderBottomWidth, bands.borderBottomColor],
            continents: [continents.borderTopWidth, continents.borderTopColor],
        };
    });

    expect(separators.continents).toEqual(separators.bands);
});

test("mobile filter tabs are shorter than tool tabs", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const navigation = page.getByRole("navigation", { name: "Workspace" });
    await navigation.getByRole("button", { name: "Filters", exact: true }).click();
    const filter_tab = await page.locator('[data-tour="mobile-quick-filters"]').boundingBox();

    await navigation.getByRole("button", { name: "Tools", exact: true }).click();
    const tool_tab = await page.locator('[data-tour="side-panel-tab-band-bar"]').boundingBox();

    expect(filter_tab.height).toBeGreaterThanOrEqual(40);
    expect(filter_tab.height).toBeLessThan(tool_tab.height);
});

test("touch long press opens Only and All in the compact desktop shell", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Open Filters", exact: true }).click();
    const band_20 = page.locator('[data-tour="band-filter-20"]');

    await band_20.dispatchEvent("pointerdown", {
        button: 0,
        clientX: 32,
        clientY: 32,
        pointerId: 1,
        pointerType: "touch",
    });
    await page.waitForTimeout(550);
    await band_20.dispatchEvent("pointerup", {
        button: 0,
        clientX: 32,
        clientY: 32,
        pointerId: 1,
        pointerType: "touch",
    });

    await expect(page.locator('[data-tour="filter-options-popup"]')).toBeVisible();
});

test("mobile filter long press opens Only and All", async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 900 });
    await page.goto("/");
    const band_20 = page.locator('[data-tour="band-filter-20"]');
    await band_20.hover();
    const popup = page.locator('[data-tour="filter-options-popup"]');
    const desktop_popup_bounds = await popup.boundingBox();
    await page.mouse.move(800, 800);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    const band_40 = page.locator('[data-tour="band-filter-40"]');
    const long_press = async target => {
        await target.dispatchEvent("pointerdown", {
            button: 0,
            clientX: 32,
            clientY: 32,
            pointerId: 1,
            pointerType: "touch",
        });
        await page.waitForTimeout(550);
        await target.dispatchEvent("pointerup", {
            button: 0,
            clientX: 32,
            clientY: 32,
            pointerId: 1,
            pointerType: "touch",
        });
        await target.dispatchEvent("click");
    };

    await band_20.click();
    await expect(band_20).toHaveAttribute("aria-pressed", "false");
    await long_press(band_20);
    await expect(popup).toBeVisible();
    await expect(band_20).toHaveAttribute("aria-pressed", "false");
    for (const action of ["filter-options-only", "filter-options-all"]) {
        const bounds = await popup.locator(`[data-tour="${action}"]`).boundingBox();
        expect(bounds.height).toBeGreaterThanOrEqual(40);
    }
    const popup_bounds = await popup.boundingBox();
    expect(popup_bounds.x).toBeGreaterThanOrEqual(0);
    expect(popup_bounds.x + popup_bounds.width).toBeLessThanOrEqual(390);
    expect(popup_bounds.width).toBeCloseTo(desktop_popup_bounds.width, 0);

    await popup.locator('[data-tour="filter-options-only"]').click();
    await expect(band_20).toHaveAttribute("aria-pressed", "true");
    await expect(band_40).toHaveAttribute("aria-pressed", "false");

    await long_press(band_20);
    await popup.locator('[data-tour="filter-options-all"]').click();
    await expect(band_40).toHaveAttribute("aria-pressed", "true");
});

for (const [width, height] of [
    [390, 844],
    [500, 900],
]) {
    test(`mobile workspace fills the shell at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto("/");
        const nav = page.getByRole("navigation", { name: "Workspace" });
        await expect(nav.getByRole("button")).toHaveText(["Map", "Spots", "Filters", "Tools"]);
        const workspace = page.locator('[data-tour="mobile-workspace"]');
        const table = nav.getByRole("button", { name: "Spots", exact: true });
        for (const name of ["Map", "Spots", "Filters", "Tools"]) {
            const tab = nav.getByRole("button", { name, exact: true });
            await tab.click();
            await expect(tab).toHaveAttribute("aria-pressed", "true");
            await expect(
                page.getByRole("button", { name: /Close .*overlay|Close Filters|Close Tools/ }),
            ).toHaveCount(0);
            await page.keyboard.press("Escape");
            await expect(tab).toHaveAttribute("aria-pressed", "true");
            if (name === "Filters") {
                for (const target of [
                    "band-filter-group",
                    "mode-filter-group",
                    "dx-continent-filters",
                    "spotter-continent-filters",
                    "continent-filter-header",
                    "swap-continent-filters",
                ]) {
                    await expect(workspace.locator(`[data-tour="${target}"]`)).toBeVisible();
                }
                await expect(
                    workspace.getByRole("button", {
                        name: "Swap DX and DE continent filters",
                        exact: true,
                    }),
                ).toBeVisible();
                await workspace
                    .getByRole("button", { name: "Custom filters", exact: true })
                    .click();
                for (const label of ["Alert", "Show Only", "Hide"])
                    await expect(
                        workspace.getByRole("heading", { name: label, exact: true }),
                    ).toBeVisible();
            }
            if (name === "Tools") {
                await expect(
                    workspace.locator('[data-tour="continent-filter-column"]'),
                ).toHaveCount(0);
                await expect(workspace.locator('[data-tour="side-panel-tab-filters"]')).toHaveCount(
                    0,
                );
                for (const [label, target] of [
                    ["Band activity", "band-bar-panel"],
                    ["Heatmap", "heatmap-panel"],
                    ["DXpeditions", "dxpeditions-panel"],
                    ["Missing", "missing-panel"],
                    ["Tours", "tour-launcher-panel"],
                ]) {
                    await workspace.getByRole("button", { name: label, exact: true }).click();
                    await expect(workspace.locator(`[data-tour="${target}"]`)).toBeVisible();
                    if (label === "Heatmap") {
                        const canvas = workspace.locator('[data-tour="heatmap-chart"] canvas');
                        const chart = workspace.locator('[data-tour="heatmap-chart"]');
                        await expect(canvas).toBeVisible();
                        await expect(
                            workspace.locator('[data-tour="heatmap-legend"]'),
                        ).toBeHidden();
                        await expect(
                            workspace.locator('[data-tour="heatmap-description"]'),
                        ).toBeHidden();
                        const [canvas_bounds, chart_bounds] = await Promise.all([
                            canvas.boundingBox(),
                            chart.boundingBox(),
                        ]);
                        expect(canvas_bounds.width).toBeLessThanOrEqual(chart_bounds.width + 1);
                        expect(canvas_bounds.height).toBeLessThanOrEqual(chart_bounds.height + 1);
                    }
                }
            }
            const bounds = await workspace.boundingBox();
            const top = await page.locator('[data-tour="top-bar"]').boundingBox();
            const bottom = await nav.boundingBox();
            expect(bounds.y).toBeCloseTo(top.y + top.height, 0);
            expect(bounds.y + bounds.height).toBeCloseTo(bottom.y, 0);
            expect(
                await page.evaluate(() => document.documentElement.scrollHeight),
            ).toBeLessThanOrEqual(height);
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeLessThanOrEqual(width);
        }
        await table.click();
        await expect
            .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mobile_panel"))))
            .toBe("table");
        await page.setViewportSize({ width: 1280, height });
        await page.setViewportSize({ width, height });
        await expect(table).toHaveAttribute("aria-pressed", "true");
    });
}

test.describe("mobile map layout", () => {
    test.use({
        propagation_data: {
            a_index: { timestamp: 100, value: 5 },
            k_index: { timestamp: 100, value: 2 },
            sfi: { timestamp: 100, value: 118 },
        },
    });

    test("places the workspace navigation below the map and propagation bars", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/");
        const navigation = page.getByRole("navigation", { name: "Workspace" });
        const map = page.locator('[data-tour="map-canvas"]');
        const propagation = page.locator('[data-tour="propagation-bars"]');
        await expect(propagation).toBeVisible();

        const navigation_box = await navigation.boundingBox();
        const map_box = await map.boundingBox();
        const propagation_box = await propagation.boundingBox();
        expect(map_box.y + map_box.height).toBeLessThanOrEqual(navigation_box.y);
        expect(propagation_box.y + propagation_box.height).toBeLessThanOrEqual(navigation_box.y);
        await expect(propagation).toHaveCSS("position", "absolute");
    });
});

test.describe("configured radio and rotator", () => {
    for (const [width, height] of [
        [390, 844],
        [500, 900],
    ]) {
        test(`mobile task bar preserves station state at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height });
            await page.routeWebSocket("**/radio", () => {});
            await page.routeWebSocket("**/ws", websocket => {
                websocket.onMessage(message => {
                    const request = JSON.parse(message);
                    if (request.type !== "spots" || request.action !== "initial") return;
                    websocket.send(
                        JSON.stringify({
                            type: "radio",
                            event: "status",
                            status: "connected",
                            freq: 14074000,
                            mode: "USB",
                            catserver_version: "catserver-v2.0.0",
                        }),
                    );
                    websocket.send(
                        JSON.stringify({
                            type: "rotator",
                            event: "status",
                            status: "connected",
                            name: "Test rotator",
                            azimuth: 125,
                        }),
                    );
                    websocket.send(JSON.stringify({ type: "spots", event: "initial", spots: [] }));
                });
            });
            await page.goto("/");
            const top = page.locator('[data-tour="top-bar"]');
            await expect(top.getByText("14.074 MHz", { exact: true })).toBeVisible();
            await expect(top.getByRole("img", { name: "Rotator connected" })).toBeVisible();
            await top.getByRole("button", { name: "Disable rotator tuning" }).click();
            await expect(top.getByRole("button", { name: "Enable rotator tuning" })).toBeVisible();
            await expect(top.locator('[data-tour="top-bar-network-state"]')).toBeVisible();
            await expect(top.getByRole("combobox", { name: "Spot window" })).toBeVisible();
            await expect(top.locator('[data-tour="top-bar-submit-spot"]')).toBeVisible();
            await expect(top.locator('[data-tour="top-bar-settings"]')).toBeVisible();
            await expect(top.locator('[data-tour="top-bar-logo"]')).toHaveCount(0);
            expect((await top.boundingBox()).height).toBeLessThanOrEqual(110);
            expect(
                await page.evaluate(() =>
                    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
                ),
            ).toBeLessThanOrEqual(width);
            expect(
                await page.evaluate(() =>
                    Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
                ),
            ).toBeLessThanOrEqual(height);
        });
    }
});

for (const width of [767, 768, 1535, 1536]) {
    test(`uses one navigation model at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        const top = page.locator('[data-tour="top-bar"]');
        const nav = page.getByRole("navigation", { name: "Workspace" });
        if (width < 768) {
            await expect(nav).toBeVisible();
            await expect(nav.getByRole("button")).toHaveText(["Map", "Spots", "Filters", "Tools"]);
            await expect(top.locator('[data-tour="top-bar-left-menu"]')).toHaveCount(0);
            await expect(top.locator('[data-tour="top-bar-right-menu"]')).toHaveCount(0);
        } else {
            await expect(nav).toHaveCount(0);
            for (const name of ["map", "table"]) {
                await expect(page.locator(`[data-tour="${name}-panel"]`)).toBeVisible();
            }
            await expect(
                top.getByRole("button", { name: /^(Open|Close) (Filters|Tools)$/ }),
            ).toHaveCount(width < 1536 ? 2 : 0);
        }
        await expect(top.locator('[data-tour^="mobile-main-tab"]')).toHaveCount(0);
        await expect(page.getByRole("button", { name: /hamburger|menu/i })).toHaveCount(0);
    });
}

for (const width of [390, 500]) {
    test(`mobile workspaces keep state and scroll at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 700 });
        await page.goto("/");
        const nav = page.getByRole("navigation", { name: "Workspace" });
        const select = name => nav.getByRole("button", { name, exact: true }).click();
        await select("Filters");
        const band = page.locator('[data-tour="band-filter-20"]');
        const before = await band.getAttribute("aria-pressed");
        await band.click();
        await expect(band).not.toHaveAttribute("aria-pressed", before);
        const dx = page.locator('[data-tour="dx-continent-filter-EU"]');
        const de = page.locator('[data-tour="spotter-continent-filter-EU"]');
        const dx_before = await dx.getAttribute("aria-pressed");
        await dx.click();
        const de_before = await de.getAttribute("aria-pressed");
        await page.locator('[data-tour="swap-continent-filters"]').click();
        await expect(dx).toHaveAttribute("aria-pressed", de_before);
        await expect(de).not.toHaveAttribute("aria-pressed", dx_before);
        const scroll = page.locator("#filters-panel .overflow-y-auto");
        const has_overflow = await scroll.evaluate(
            element => element.scrollHeight > element.clientHeight,
        );
        await scroll.evaluate(element => {
            element.scrollTop = 160;
        });
        const offset = await scroll.evaluate(element => element.scrollTop);
        if (has_overflow) expect(offset).toBeGreaterThan(0);
        else expect(offset).toBe(0);
        await select("Spots");
        await select("Filters");
        await expect(band).not.toHaveAttribute("aria-pressed", before);
        expect(await scroll.evaluate(element => element.scrollTop)).toBe(offset);
        await page.getByRole("button", { name: "Custom filters", exact: true }).click();
        await select("Map");
        await select("Filters");
        await expect(page.locator('[data-tour="filters-panel"]')).toBeVisible();
        await page.locator('[data-tour="add-filter-button-alert"]').click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toBeHidden();
        await expect(nav.getByRole("button", { name: "Filters", exact: true })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        await select("Tools");
        await page.getByRole("button", { name: "Heatmap", exact: true }).click();
        const region = page.locator('[data-tour="heatmap-continent-selector"]');
        await region.selectOption("NA");
        await select("Spots");
        const search = page.locator('[data-tour="table-search-mobile"] input');
        await search.fill("JA1");
        await select("Map");
        await select("Spots");
        await expect(search).toHaveValue("JA1");
        await select("Tools");
        await expect(region).toBeVisible();
        await expect(region).toHaveValue("NA");
        await page.reload();
        await expect(nav.getByRole("button", { name: "Tools", exact: true })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        await expect(region).toHaveValue("NA");
        await select("Filters");
        await page.reload();
        await expect(nav.getByRole("button", { name: "Filters", exact: true })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
        await expect(band).not.toHaveAttribute("aria-pressed", before);
    });
}

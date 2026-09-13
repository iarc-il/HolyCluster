import { test as base, expect } from "@playwright/test";

const current_time = Math.floor(Date.now() / 1000);

// Synthetic but geographically plausible spots. They stay within the default
// one-hour window while exercising multiple bands, modes, and continents.
export const tour_spots = [
    {
        time: current_time - 45,
        spotter_callsign: "K1TEST",
        dx_callsign: "JA1XYZ",
        freq: 14.074,
        band: 20,
        mode: "FT8",
        dx_dxcc_code: 339,
        spotter_dxcc_code: 291,
        dx_continent: "AS",
        spotter_continent: "NA",
        dx_loc: [139.69, 35.68],
        spotter_loc: [-71.06, 42.36],
        comment: "CQ DX from Tokyo",
    },
    {
        time: current_time - 120,
        spotter_callsign: "DL1TEST",
        dx_callsign: "PY2XYZ",
        freq: 7.074,
        band: 40,
        mode: "FT8",
        dx_dxcc_code: 108,
        spotter_dxcc_code: 230,
        dx_continent: "SA",
        spotter_continent: "EU",
        dx_loc: [-46.63, -23.55],
        spotter_loc: [13.4, 52.52],
        comment: "Good copy on 40 meters",
    },
    {
        time: current_time - 210,
        spotter_callsign: "VK3TEST",
        dx_callsign: "ZS6TEST",
        freq: 14.06,
        band: 20,
        mode: "CW",
        dx_dxcc_code: 462,
        spotter_dxcc_code: 150,
        dx_continent: "AF",
        spotter_continent: "OC",
        dx_loc: [28.19, -25.75],
        spotter_loc: [144.96, -37.81],
        comment: "Short path CW",
    },
    {
        time: current_time - 300,
        spotter_callsign: "F4TEST",
        dx_callsign: "K1ABC",
        freq: 21.14,
        band: 15,
        mode: "FT4",
        dx_dxcc_code: 291,
        spotter_dxcc_code: 227,
        dx_continent: "NA",
        spotter_continent: "EU",
        dx_loc: [-71.06, 42.36],
        spotter_loc: [2.35, 48.86],
        comment: "Morning opening",
    },
    {
        time: current_time - 390,
        spotter_callsign: "JA1XYZ",
        dx_callsign: "DL1TEST",
        freq: 18.1,
        band: 17,
        mode: "FT8",
        dx_dxcc_code: 230,
        spotter_dxcc_code: 339,
        dx_continent: "EU",
        spotter_continent: "AS",
        dx_loc: [13.4, 52.52],
        spotter_loc: [139.69, 35.68],
        comment: "Worked before sunrise",
    },
    {
        time: current_time - 480,
        spotter_callsign: "VE3TEST",
        dx_callsign: "I2TEST",
        freq: 7.12,
        band: 40,
        mode: "SSB",
        dx_dxcc_code: 248,
        spotter_dxcc_code: 1,
        dx_continent: "EU",
        spotter_continent: "NA",
        dx_loc: [9.19, 45.46],
        spotter_loc: [-79.38, 43.65],
        comment: "Readable SSB signal",
    },
    {
        time: current_time - 570,
        spotter_callsign: "ZS6TEST",
        dx_callsign: "VK3TEST",
        freq: 28.074,
        band: 10,
        mode: "DIGI",
        dx_dxcc_code: 150,
        spotter_dxcc_code: 462,
        dx_continent: "OC",
        spotter_continent: "AF",
        dx_loc: [144.96, -37.81],
        spotter_loc: [28.19, -25.75],
        comment: "Ten meter path opening",
    },
];

export const tour_spot = tour_spots[0];

// These interactions intentionally need the page outside the spotlight: drag/drop and
// dismissing a portal menu by clicking away. All other steps without a primary button
// must visibly spotlight their interaction target.
const no_spotlight_interaction_steps = new Set([
    "filters_drag_the_new_filter",
    "spots_table_callsign_actions",
    "spots_table_entity_actions",
]);

export const test = base.extend({
    tour_spots: [tour_spots, { option: true }],
    auto_start_tour: [false, { option: true }],
    page: async ({ page, tour_spots, auto_start_tour }, use) => {
        const browser_errors = [];
        page.on("pageerror", error => browser_errors.push(`pageerror: ${error.message}`));
        page.on("console", message => {
            if (message.type() === "error") browser_errors.push(`console: ${message.text()}`);
        });

        await page.addInitScript(auto_start => {
            localStorage.clear();
            sessionStorage.clear();
            localStorage.setItem("first_launch", JSON.stringify(auto_start));
            localStorage.setItem("active_view", "0");
            localStorage.setItem("mobile_tab", JSON.stringify("map"));
            localStorage.removeItem("tour_completed_chapters");
        }, auto_start_tour);

        await page.route("**/propagation", route =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: "null",
            }),
        );
        await page.route("**/dxpeditions", route =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: "[]",
            }),
        );
        await page.routeWebSocket("**/ws", websocket => {
            websocket.onMessage(message => {
                const request = JSON.parse(message);
                if (request.type !== "spots" || request.action !== "initial") return;

                websocket.send(
                    JSON.stringify({
                        type: "spots",
                        event: "initial",
                        spots: tour_spots,
                    }),
                );
            });
        });

        await use(page);
        expect(browser_errors, "browser console/runtime errors").toEqual([]);
    },
});

export { expect };

export const tour_target = name => `[data-tour='${name}']`;

export async function open_tour_launcher(page) {
    const launcher = page.locator(tour_target("tour-launcher"));
    const launcher_button = launcher.locator("button");
    if (!(await launcher_button.isVisible())) {
        await page.locator(tour_target("top-bar-left-menu")).locator("button").click();
    }
    await expect(launcher_button).toBeVisible();
    await launcher_button.click();
    await expect(page.locator(tour_target("tour-launcher-panel"))).toBeVisible();
}

export async function start_tour(page, chapter_title) {
    await open_tour_launcher(page);

    const panel = page.locator(tour_target("tour-launcher-panel"));
    await panel.getByRole("button", { name: `Select ${chapter_title} tour` }).click();
    await panel.getByRole("button", { name: "Start tour", exact: true }).click();
}

async function expect_in_viewport(locator, viewport, description) {
    const box = await locator.boundingBox();
    expect(box, `${description} has no bounding box`).not.toBeNull();
    expect(box.x, `${description} left`).toBeGreaterThanOrEqual(0);
    expect(box.y, `${description} top`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${description} right`).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height, `${description} bottom`).toBeLessThanOrEqual(viewport.height);
}

async function expect_intersects_viewport(locator, viewport, description) {
    const box = await locator.boundingBox();
    expect(box, `${description} has no bounding box`).not.toBeNull();
    expect(box.x + box.width, `${description} right edge`).toBeGreaterThan(0);
    expect(box.y + box.height, `${description} bottom edge`).toBeGreaterThan(0);
    expect(box.x, `${description} left edge`).toBeLessThan(viewport.width);
    expect(box.y, `${description} top edge`).toBeLessThan(viewport.height);
}

async function expect_spotlight(page, expected, description) {
    await expect
        .poll(
            () =>
                page.locator("[data-testid='spotlight'] path").evaluateAll(paths =>
                    paths.some(path => {
                        const style = getComputedStyle(path);
                        return style.stroke !== "none" && style.strokeWidth !== "0px";
                    }),
                ),
            { message: `${description} spotlight state` },
        )
        .toBe(expected);
}

export async function expect_tour_step(page, id, target) {
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    const tooltip = page.locator(".react-joyride__tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveAttribute("data-joyride-id", id);

    const requires_interaction =
        (await tooltip.locator("[data-testid='button-primary']").count()) === 0;
    if (requires_interaction) {
        await expect_spotlight(page, !no_spotlight_interaction_steps.has(id), id);
    }

    await expect_in_viewport(tooltip, viewport, `${id} tooltip`);

    const target_locator = page.locator(target).first();
    await expect(target_locator).toBeVisible();
    await expect_intersects_viewport(target_locator, viewport, `${id} target`);

    const buttons = tooltip.locator("button");
    for (const button of await buttons.all()) {
        if (await button.isVisible()) {
            await expect_in_viewport(button, viewport, `${id} button`);
        }
    }
}

export async function next_tour_step(page) {
    const next_button = page.locator(".react-joyride__tooltip").getByRole("button", {
        name: /^Next/,
    });
    await expect(next_button).toBeVisible();
    await next_button.click();
}

export async function back_tour_step(page) {
    const back_button = page
        .locator(".react-joyride__tooltip")
        .getByRole("button", { name: "Back", exact: true });
    await expect(back_button).toBeVisible();
    await back_button.click();
}

export async function close_tour(page) {
    await page.locator(".react-joyride__tooltip").locator("[data-testid='button-close']").click();
    await expect(page.locator(".react-joyride__tooltip")).toBeHidden();
}

export async function skip_tour(page) {
    await page.locator(".react-joyride__tooltip").locator("[data-testid='button-skip']").click();
    await expect(page.locator(".react-joyride__tooltip")).toBeHidden();
}

export async function finish_tour(page) {
    await page
        .locator(".react-joyride__tooltip")
        .getByRole("button", {
            name: /^Done/,
        })
        .click();
    await expect(page.locator(".react-joyride__tooltip")).toBeHidden();
}

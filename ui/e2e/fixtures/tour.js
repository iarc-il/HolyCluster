import { test as base, expect } from "@playwright/test";

const current_time = Math.floor(Date.now() / 1000);
export const tour_spot = {
    time: current_time,
    spotter_callsign: "N0CALL",
    dx_callsign: "K1ABC",
    freq: 14074,
    band: 20,
    mode: "FT8",
    dx_dxcc_code: 291,
    spotter_dxcc_code: 291,
    dx_continent: "NA",
    spotter_continent: "NA",
    dx_loc: [-73.9, 40.7],
    spotter_loc: [-75.1, 40.0],
    comment: "Tour fixture",
};

export const test = base.extend({
    tour_spots: [[], { option: true }],
    page: async ({ page, tour_spots }, use) => {
        await page.addInitScript(() => {
            localStorage.clear();
            sessionStorage.clear();
            localStorage.setItem("first_launch", "false");
            localStorage.setItem("active_view", "0");
            localStorage.setItem("mobile_tab", JSON.stringify("map"));
            localStorage.removeItem("tour_completed_chapters");
        });

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

export async function expect_tour_step(page, id, target) {
    const tooltip = page.locator(".react-joyride__tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveAttribute("data-joyride-id", id);
    await expect(page.locator(target).first()).toBeVisible();
}

export async function next_tour_step(page) {
    await page
        .locator(".react-joyride__tooltip")
        .getByRole("button", {
            name: /^Next/,
        })
        .click();
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

import { expect, test } from "@playwright/test";

const PROFILE_STORE = {
    version: 1,
    active_profile_name: "Default",
    profiles: [
        {
            name: "Default",
            data: {
                history: {
                    window_size_ms: 30 * 60 * 1000,
                    step_size_ms: 30 * 60 * 1000,
                    display_hours: 1,
                },
            },
        },
    ],
};

function history_spot(time, dx_callsign) {
    return {
        time,
        spotter_callsign: "K1TEST",
        dx_callsign,
        freq: 14.074,
        band: 20,
        mode: "FT8",
        dx_dxcc_code: 339,
        spotter_dxcc_code: 291,
        dx_continent: "AS",
        spotter_continent: "NA",
        dx_loc: [139.69, 35.68],
        spotter_loc: [-71.06, 42.36],
        comment: "Historical playback spot",
    };
}

test("plays back historical spots and propagation over the canonical WebSocket", async ({
    page,
}) => {
    const history_requests = [];
    let initial_start = null;

    await page.addInitScript(profile_store => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem("first_launch", "false");
        localStorage.setItem("active_view", "0");
        localStorage.setItem("mobile_tab", JSON.stringify("map"));
        localStorage.setItem("profiles", JSON.stringify(profile_store));
    }, PROFILE_STORE);

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

            if (request.type === "spots" && request.action === "initial") {
                websocket.send(
                    JSON.stringify({
                        version: 1,
                        type: "spots",
                        event: "initial",
                        spots: [],
                    }),
                );
                return;
            }

            if (request.type !== "history") return;
            history_requests.push(request);
            if (request.event === "spots" && initial_start === null) {
                initial_start = request.start_time;
            }

            if (initial_start !== null && request.end_time <= initial_start) return;

            const is_next_range = initial_start !== null && request.start_time > initial_start;
            if (request.event === "spots") {
                websocket.send(
                    JSON.stringify({
                        version: 1,
                        type: "history",
                        event: "spots",
                        start_time: request.start_time,
                        end_time: request.end_time,
                        spots: {
                            spots: [
                                history_spot(
                                    request.start_time + 60,
                                    is_next_range ? "JA2HST" : "JA1HST",
                                ),
                            ],
                        },
                    }),
                );
                return;
            }

            const value = is_next_range ? 71 : 17;
            const timestamp = request.start_time + 1;
            websocket.send(
                JSON.stringify({
                    version: 1,
                    type: "history",
                    event: "propagation",
                    start_time: request.start_time,
                    end_time: request.end_time,
                    metrics: {
                        a_index: [{ timestamp, value }],
                        k_index: [{ timestamp, value: is_next_range ? 6 : 2 }],
                        sfi: [{ timestamp, value: is_next_range ? 122 : 111 }],
                    },
                }),
            );
        });
    });

    await page.goto("/");
    await page.locator("[data-tour='map-history-toggle']").click();

    await expect(page.locator("[data-tour='history-bar']")).toBeVisible();
    await expect(page.getByText("JA1HST", { exact: true })).toBeVisible();
    await expect(page.locator("[data-tour='propagation-a-index']")).toContainText("17");

    await expect
        .poll(() => history_requests.filter(request => request.event === "spots").length)
        .toBeGreaterThan(1);
    await expect
        .poll(() => history_requests.filter(request => request.event === "propagation").length)
        .toBeGreaterThan(1);

    const history_events = new Set(history_requests.map(request => request.event));
    expect(history_events).toEqual(new Set(["spots", "propagation"]));
    expect(history_requests.every(request => request.version === 1)).toBe(true);

    await page.locator("[data-tour='history-bar']").getByTitle("Step forward one window").click();

    await expect(page.getByText("JA1HST", { exact: true })).toHaveCount(0);
    await expect(page.getByText("JA2HST", { exact: true })).toBeVisible();
    await expect(page.locator("[data-tour='propagation-a-index']")).toContainText("71");

    const spot_starts = new Set(
        history_requests
            .filter(request => request.event === "spots")
            .map(request => request.start_time),
    );
    expect(spot_starts.size).toBeGreaterThan(1);
});

import { expect, test } from "@playwright/test";

function spot(time, dx_callsign) {
    return {
        time,
        dx_callsign,
        spotter_callsign: "K1TEST",
        freq: 14.074,
        band: 20,
        mode: "FT8",
        dx_dxcc_code: 339,
        spotter_dxcc_code: 291,
        dx_continent: "AS",
        spotter_continent: "NA",
        dx_loc: [139.69, 35.68],
        spotter_loc: [-71.06, 42.36],
        comment: "Recovery test",
    };
}

for (const scenario of ["dropped", "delayed", "legacy"]) {
    test(`recovers ${scenario} spot subscription without reloading`, async ({ page }) => {
        const requests = [];
        const time = Math.floor(Date.now() / 1000);
        await page.addInitScript(() => {
            localStorage.clear();
            sessionStorage.clear();
            localStorage.setItem("first_launch", "false");
            localStorage.setItem("active_view", "0");
            localStorage.setItem("mobile_tab", JSON.stringify("map"));
        });
        for (const endpoint of ["propagation", "dxpeditions"]) {
            await page.route(`**/${endpoint}`, route =>
                route.fulfill({
                    contentType: "application/json",
                    body: endpoint === "dxpeditions" ? "[]" : "null",
                }),
            );
        }
        await page.routeWebSocket("**/radio", socket => {
            if (scenario === "legacy")
                socket.send(
                    JSON.stringify({
                        status: "connected",
                        version: "catserver-v1.2.1",
                    }),
                );
        });
        const handle = socket => {
            if (scenario !== "legacy")
                socket.send(
                    JSON.stringify({
                        version: 1,
                        type: "radio",
                        event: "status",
                        status: "unavailable",
                        catserver_version: "catserver-v2.0.0",
                    }),
                );
            socket.onMessage(message => {
                const request = JSON.parse(message);
                if (request.type !== "spots") return;
                requests.push(request);
                const response = {
                    version: 1,
                    type: "spots",
                    event: "initial",
                    spots: [spot(time, "JA1REC")],
                    subscription_id: request.subscription_id,
                    subscription_ack: true,
                };
                if (requests.length === 1) {
                    if (scenario === "delayed") {
                        socket.send(
                            JSON.stringify({
                                version: 1,
                                type: "spots",
                                event: "update",
                                spots: [spot(time + 1, "JA2REC")],
                            }),
                        );
                        setTimeout(() => {
                            socket.send(JSON.stringify(response));
                            socket.send(JSON.stringify(response));
                        }, 1800);
                    }
                    return;
                }
                socket.send(JSON.stringify(response));
                socket.send(JSON.stringify(response));
            });
        };
        await page.routeWebSocket("**/ws", socket => {
            if (scenario !== "legacy") handle(socket);
        });
        await page.routeWebSocket("**/submit_spot", handle);
        await page.goto("/");
        await expect(page.getByText("JA1REC", { exact: true })).toBeVisible();
        if (scenario === "delayed") {
            await expect(page.getByText("JA2REC", { exact: true })).toBeVisible();
        }
        await page.waitForTimeout(3500);
        expect(requests).toHaveLength(2);
        expect(requests[0]).toEqual(requests[1]);
        await expect(page.getByText("JA1REC", { exact: true })).toHaveCount(1);
    });
}

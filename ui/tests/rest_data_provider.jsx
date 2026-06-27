import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RestDataProvider, useRestData } from "@/hooks/useRestData.jsx";

function json_response(data) {
    return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(data),
    });
}

function RestDataHarness() {
    const { propagation } = useRestData();
    return <div data-testid="propagation">{JSON.stringify(propagation ?? null)}</div>;
}

function CacheRangeHarness() {
    const [range, set_range] = useState({ start: 100, end: 400, time: 250 });

    return (
        <RestDataProvider
            propagation_range_start={range.start}
            propagation_range_end={range.end}
            propagation_time={range.time}
        >
            <RestDataHarness />
            <button type="button" onClick={() => set_range({ start: 150, end: 300, time: 250 })}>
                Use nested range
            </button>
            <button type="button" onClick={() => set_range({ start: 500, end: 700, time: 600 })}>
                Use uncached range
            </button>
        </RestDataProvider>
    );
}

function render_provider(props = {}) {
    return render(
        <RestDataProvider {...props}>
            <RestDataHarness />
        </RestDataProvider>,
    );
}

function history_fetch_count() {
    return fetch.mock.calls.filter(([url]) => String(url).startsWith("/propagation/history"))
        .length;
}

describe("RestDataProvider propagation data", () => {
    const live_propagation = {
        a_index: { timestamp: 100, value: 5 },
        k_index: { timestamp: 100, value: 2 },
        sfi: { timestamp: 100, value: 118 },
    };

    const history_response = {
        start_time: 100,
        end_time: 400,
        metrics: {
            a_index: [
                { timestamp: 100, value: 5 },
                { timestamp: 300, value: 7 },
            ],
            k_index: [
                { timestamp: 90, value: 1.33 },
                { timestamp: 200, value: 2.67 },
            ],
            sfi: [
                { timestamp: 80, value: 118 },
                { timestamp: 250, value: 121 },
            ],
        },
    };

    beforeEach(() => {
        Object.defineProperty(window.navigator, "onLine", {
            configurable: true,
            value: true,
        });

        vi.stubGlobal(
            "fetch",
            vi.fn(url => {
                const url_string = String(url);
                if (url_string === "/propagation") return json_response(live_propagation);
                if (url_string === "/dxpeditions") return json_response([]);
                if (url_string.startsWith("/propagation/history")) {
                    return json_response(history_response);
                }
                throw new Error(`Unexpected fetch: ${url_string}`);
            }),
        );
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it("uses live propagation in live mode", async () => {
        render_provider();

        await waitFor(() =>
            expect(JSON.parse(screen.getByTestId("propagation").textContent)).toEqual(
                live_propagation,
            ),
        );

        expect(fetch).toHaveBeenCalledWith("/propagation");
    });

    it("fetches history range and selects propagation for playback time", async () => {
        render_provider({
            propagation_range_start: 100,
            propagation_range_end: 400,
            propagation_time: 250,
        });

        await waitFor(() =>
            expect(JSON.parse(screen.getByTestId("propagation").textContent)).toEqual({
                a_index: { timestamp: 100, value: 5 },
                k_index: { timestamp: 200, value: 2.67 },
                sfi: { timestamp: 250, value: 121 },
            }),
        );

        expect(fetch).not.toHaveBeenCalledWith("/propagation");
        expect(history_fetch_count()).toBe(1);
        expect(fetch.mock.calls.map(([url]) => String(url))).toContain(
            "/propagation/history?start_time=100&end_time=400",
        );
    });

    it("reuses cached propagation history for a nested range", async () => {
        render(<CacheRangeHarness />);

        await waitFor(() =>
            expect(JSON.parse(screen.getByTestId("propagation").textContent)).toEqual({
                a_index: { timestamp: 100, value: 5 },
                k_index: { timestamp: 200, value: 2.67 },
                sfi: { timestamp: 250, value: 121 },
            }),
        );

        fireEvent.click(screen.getByText("Use nested range"));

        await waitFor(() => expect(history_fetch_count()).toBe(1));
        expect(JSON.parse(screen.getByTestId("propagation").textContent)).toEqual({
            a_index: { timestamp: 100, value: 5 },
            k_index: { timestamp: 200, value: 2.67 },
            sfi: { timestamp: 250, value: 121 },
        });
    });

    it("clears stale history when moving to an uncached range offline", async () => {
        render(<CacheRangeHarness />);

        await waitFor(() =>
            expect(JSON.parse(screen.getByTestId("propagation").textContent)).toEqual({
                a_index: { timestamp: 100, value: 5 },
                k_index: { timestamp: 200, value: 2.67 },
                sfi: { timestamp: 250, value: 121 },
            }),
        );

        Object.defineProperty(window.navigator, "onLine", {
            configurable: true,
            value: false,
        });
        fireEvent.click(screen.getByText("Use uncached range"));

        await waitFor(() => expect(screen.getByTestId("propagation").textContent).toBe("null"));
        expect(history_fetch_count()).toBe(1);
    });
});

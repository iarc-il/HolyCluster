import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const websocket = vi.hoisted(() => ({
    readyState: 0,
    send: vi.fn(),
    handler: null,
    snapshot: [],
}));
vi.mock("@/hooks/useWs", () => ({
    ReadyState: { OPEN: 1 },
    useWs: () => ({ readyState: websocket.readyState, send: websocket.send }),
    useWsMessage: (_type, handler) => {
        websocket.handler = handler;
    },
}));
vi.mock("@/utils/live_spot_snapshot.js", () => ({
    read_live_spot_snapshot: () => websocket.snapshot,
    write_live_spot_snapshot: vi.fn(),
}));
import useSpotWebSocket from "@/hooks/useSpotWebSocket.js";

const spot = {
    time: 2000000000,
    spotter_callsign: "K1ABC",
    dx_callsign: "K2ABC",
    dx_dxcc_code: 291,
    spotter_dxcc_code: 291,
    mode: "CW",
    band: 20,
    dx_continent: "NA",
    spotter_continent: "NA",
    dx_cq_zone: 5,
    dx_itu_zone: 8,
    spotter_cq_zone: 5,
    spotter_itu_zone: 8,
    dx_state: "NY",
    spotter_state: "NY",
};

describe("spot subscriptions", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(spot.time * 1000);
        websocket.readyState = 0;
        websocket.send = vi.fn();
        websocket.snapshot = [];
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    function connect(view, state) {
        websocket.readyState = state;
        view.rerender();
    }
    function initial(spots) {
        act(() => websocket.handler({ event: "initial", spots }));
    }

    it("requests initial again after an empty initial response and reconnect", () => {
        const view = renderHook(useSpotWebSocket);
        expect(websocket.send).not.toHaveBeenCalled();
        connect(view, 1);
        initial([]);
        view.rerender();
        expect(websocket.send).toHaveBeenCalledTimes(1);
        connect(view, 3);
        connect(view, 0);
        connect(view, 1);
        expect(websocket.send.mock.calls).toEqual([
            ["spots", { action: "initial" }],
            ["spots", { action: "initial" }],
        ]);
    });

    it("uses catch-up after a nonempty response, once per connection", () => {
        const view = renderHook(useSpotWebSocket);
        connect(view, 1);
        initial([spot]);
        expect(view.result.current.raw_spots).toHaveLength(1);
        connect(view, 3);
        connect(view, 1);
        expect(websocket.send).toHaveBeenLastCalledWith("spots", {
            action: "catch_up",
            last_time: spot.time,
        });
        websocket.send = vi.fn();
        view.rerender();
        expect(websocket.send).not.toHaveBeenCalled();
    });

    it("still requests initial when only a persisted snapshot is present", () => {
        websocket.snapshot = [{ ...spot, id: "cached" }];
        const view = renderHook(useSpotWebSocket);
        connect(view, 1);
        expect(websocket.send).toHaveBeenCalledExactlyOnceWith("spots", { action: "initial" });
    });
});

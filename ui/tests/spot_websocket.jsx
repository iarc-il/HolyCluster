import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const websocket = vi.hoisted(() => ({
    readyState: 0,
    epoch: null,
    transport: "unified",
    send: vi.fn(),
    handlers: new Set(),
    subscribe: (_type, handler) => {
        websocket.handlers.add(handler);
        return () => websocket.handlers.delete(handler);
    },
    snapshot: [],
}));
vi.mock("@/hooks/useWs", () => ({
    ReadyState: { OPEN: 1 },
    useWs: () => ({
        readyState: websocket.readyState,
        spot_socket_epoch: websocket.epoch,
        transport: websocket.transport,
        send_now: websocket.send,
        subscribe: websocket.subscribe,
    }),
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

function receive(spots, fields = {}) {
    act(() => {
        for (const handler of websocket.handlers) handler({ event: "initial", spots, ...fields });
    });
}
function connect(view, epoch = 1) {
    websocket.readyState = epoch == null ? 3 : 1;
    websocket.epoch = epoch;
    view.rerender();
}
function ack(spots = []) {
    receive(spots, {
        subscription_ack: true,
        subscription_id: websocket.send.mock.lastCall[1].subscription_id,
    });
}

describe("spot subscriptions", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(spot.time * 1000);
        websocket.readyState = 0;
        websocket.epoch = null;
        websocket.transport = "unified";
        websocket.send = vi.fn(() => true);
        websocket.snapshot = [];
    });
    afterEach(() => {
        cleanup();
        websocket.handlers.clear();
        vi.useRealTimers();
    });

    it.each([false, true])("retries a lost request (send=%s) with a listener installed", sent => {
        websocket.send.mockImplementation(() => {
            expect(websocket.handlers.size).toBe(1);
            return sent;
        });
        const view = renderHook(useSpotWebSocket);
        connect(view);
        expect(websocket.send).toHaveBeenCalledTimes(1);
        act(() => vi.advanceTimersByTime(1200));
        expect(websocket.send).toHaveBeenCalledTimes(2);
        expect(websocket.send.mock.calls[0]).toEqual(websocket.send.mock.calls[1]);
        ack();
        act(() => vi.advanceTimersByTime(120000));
        expect(websocket.send).toHaveBeenCalledTimes(2);
    });

    it("merges delayed and duplicate initial responses without erasing live data", () => {
        const view = renderHook(useSpotWebSocket);
        connect(view);
        const newer = { ...spot, time: spot.time + 1, dx_callsign: "K3ABC" };
        receive([newer, newer, { ...spot, comment: "Live value" }], { event: "update" });
        ack([spot, spot]);
        ack([spot]);
        expect(view.result.current.raw_spots.map(row => row.dx_callsign)).toEqual([
            "K3ABC",
            "K2ABC",
        ]);
        expect(view.result.current.raw_spots[1].comment).toBe("Live value");
    });

    it("freezes the catch-up cursor while live updates arrive and retries remain bounded", () => {
        const view = renderHook(useSpotWebSocket);
        connect(view);
        ack([spot]);
        connect(view, 2);
        const request = websocket.send.mock.lastCall[1];
        expect(request).toMatchObject({ action: "catch_up", last_time: spot.time });
        receive([{ ...spot, time: spot.time + 1 }], { event: "update" });
        act(() => vi.advanceTimersByTime(120000));
        expect(websocket.send.mock.calls.length).toBeGreaterThan(2);
        expect(websocket.send.mock.calls.length).toBeLessThanOrEqual(8);
        for (const call of websocket.send.mock.calls.slice(1)) expect(call[1]).toEqual(request);
        ack([]);
        const count = websocket.send.mock.calls.length;
        act(() => vi.advanceTimersByTime(120000));
        expect(websocket.send).toHaveBeenCalledTimes(count);
    });

    it("cancels old epochs and ignores their acknowledgements", () => {
        const view = renderHook(useSpotWebSocket);
        connect(view);
        const old = websocket.send.mock.lastCall[1].subscription_id;
        connect(view, null);
        act(() => vi.advanceTimersByTime(60000));
        expect(websocket.send).toHaveBeenCalledTimes(1);
        connect(view, 2);
        receive([], { subscription_ack: true, subscription_id: old });
        act(() => vi.advanceTimersByTime(1200));
        expect(websocket.send).toHaveBeenCalledTimes(3);
        expect(websocket.send.mock.lastCall[2]).toBe(2);
    });

    it("keeps one listener and retry timer through StrictMode cleanup", () => {
        websocket.readyState = 1;
        websocket.epoch = 1;
        const view = renderHook(useSpotWebSocket, { wrapper: StrictMode });
        expect(websocket.handlers.size).toBe(1);
        const count = websocket.send.mock.calls.length;
        expect(count).toBeLessThanOrEqual(2);
        act(() => vi.advanceTimersByTime(2400));
        expect(websocket.send).toHaveBeenCalledTimes(count + 1);
        view.unmount();
        expect(websocket.handlers.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("cancels a pending request when the selected transport changes", () => {
        const view = renderHook(useSpotWebSocket);
        connect(view);
        const first = websocket.send.mock.lastCall[1].subscription_id;
        websocket.transport = "cat_v1_2";
        connect(view, 2);
        expect(websocket.send.mock.lastCall[1].subscription_id).not.toBe(first);
        act(() => vi.advanceTimersByTime(1200));
        expect(websocket.send).toHaveBeenCalledTimes(3);
        expect(websocket.send.mock.lastCall[2]).toBe(2);
    });

    it("does not reuse correlation IDs after unmounting on the same socket", () => {
        const first_view = renderHook(useSpotWebSocket);
        connect(first_view);
        const first = websocket.send.mock.lastCall[1].subscription_id;
        first_view.unmount();
        renderHook(useSpotWebSocket);
        expect(websocket.send.mock.lastCall[1].subscription_id).not.toBe(first);
    });

    it("handles synchronous empty acknowledgements without scheduling a retry", () => {
        websocket.send.mockImplementation((_type, request) => {
            for (const handler of websocket.handlers)
                handler({
                    event: "initial",
                    spots: [],
                    subscription_ack: true,
                    subscription_id: request.subscription_id,
                });
            return true;
        });
        websocket.readyState = 1;
        websocket.epoch = 1;
        renderHook(useSpotWebSocket, { wrapper: StrictMode });
        act(() => vi.advanceTimersByTime(120000));
        expect(websocket.send).toHaveBeenCalledTimes(1);
    });

    it("keeps the cached snapshot and tour buffer while merging an initial batch", () => {
        websocket.snapshot = [
            {
                ...spot,
                id: `${spot.time}|${spot.spotter_callsign}|${spot.dx_callsign}`,
                comment: "Cached value",
            },
        ];
        const view = renderHook(useSpotWebSocket);
        connect(view);
        expect(websocket.send.mock.lastCall[1].action).toBe("initial");
        act(() => view.result.current.set_spot_buffering(true));
        receive([{ ...spot, dx_callsign: "K3ABC" }], { event: "update" });
        ack([spot]);
        expect(view.result.current.raw_spots).toHaveLength(1);
        expect(view.result.current.raw_spots[0].comment).toBeUndefined();
        expect(view.result.current.raw_spots.some(row => row.dx_callsign === "K3ABC")).toBe(false);
        act(() => view.result.current.set_spot_buffering(false));
        expect(view.result.current.raw_spots.some(row => row.dx_callsign === "K3ABC")).toBe(true);
    });
});

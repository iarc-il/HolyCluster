import {
    HISTORY_OPEN_TIMEOUT_MS,
    HISTORY_RESPONSE_TIMEOUT_MS,
    fetch_window,
} from "@/utils/interval_cache";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ ws: null, calls: [] }));
vi.mock("@/hooks/useWs", () => ({
    ReadyState: { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 },
    useWs: () => state.ws,
}));
vi.mock("@/utils/spot_cache_db.jsx", () => ({
    subscribe: () => () => {},
    get_version: () => 0,
    get_spots: () => ({ spots: [], is_complete: false }),
    ensure_spots_loaded: (...args) => load("spots", args),
}));
vi.mock("@/utils/propagation_cache_db.jsx", () => ({
    subscribe: () => () => {},
    get_version: () => 0,
    get_propagation: () => ({ propagation_history: null, is_complete: false }),
    ensure_propagation_loaded: (...args) => load("propagation", args),
}));
import useHistoryPropagation from "@/hooks/useHistoryPropagation";
import useHistorySpots from "@/hooks/useHistorySpots";

function load(event, [send, subscribe, wait, start, end, signal]) {
    state.calls.push({ event, start, end, signal });
    return fetch_window(
        send,
        subscribe,
        wait,
        event,
        start / 1000,
        end / 1000,
        signal,
        d => d.payload,
    );
}

function transport() {
    const handlers = new Set();
    const send = vi.fn(); // Legacy/custom transports return void.
    return {
        readyState: 1,
        send,
        handlers,
        wait_for_open: vi.fn(() => Promise.resolve()),
        subscribe: vi.fn((type, handler) => {
            expect(type).toBe("history");
            handlers.add(handler);
            return () => handlers.delete(handler);
        }),
        receive: data => {
            for (const handler of [...handlers]) handler(data);
        },
    };
}
const flush = async () => {
    await act(async () => {});
};

beforeEach(() => {
    vi.useFakeTimers();
    state.ws = transport();
    state.calls = [];
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("bounded history requests", () => {
    const request = (signal, extract = d => d.payload) =>
        fetch_window(
            state.ws.send,
            state.ws.subscribe,
            state.ws.wait_for_open,
            "spots",
            10,
            20,
            signal,
            extract,
        );
    it("bounds opening and ignores a late open after cleanup", async () => {
        let open;
        state.ws.wait_for_open.mockImplementation(
            () =>
                new Promise(resolve => {
                    open = resolve;
                }),
        );
        const result = request();
        const rejected = expect(result).rejects.toThrow("connection timed out");
        await vi.advanceTimersByTimeAsync(HISTORY_OPEN_TIMEOUT_MS);
        await rejected;
        expect(state.ws.handlers.size).toBe(0);
        open();
        await flush();
        expect(state.ws.send).not.toHaveBeenCalled();
    });
    it("bounds a lost response and ignores stale responses", async () => {
        const result = request();
        const rejected = expect(result).rejects.toThrow("response timed out");
        await vi.advanceTimersByTimeAsync(HISTORY_RESPONSE_TIMEOUT_MS);
        await rejected;
        expect(state.ws.handlers.size).toBe(0);
        state.ws.receive({ event: "spots", start_time: 10, end_time: 20 });
        expect(vi.getTimerCount()).toBe(0);
    });
    it("preserves event and window matching with custom void-returning sends", async () => {
        const result = request();
        await flush();
        state.ws.receive({ event: "propagation", start_time: 10, end_time: 20 });
        state.ws.receive({ event: "spots", start_time: 11, end_time: 20 });
        expect(state.ws.handlers.size).toBe(1);
        state.ws.receive({ event: "spots", start_time: 10, end_time: 20, payload: [1] });
        await expect(result).resolves.toEqual([1]);
        expect(state.ws.handlers.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });
    it.each(["opening", "sending", "extracting"])("cleans up after %s throws", async phase => {
        if (phase === "opening")
            state.ws.wait_for_open.mockImplementation(() => {
                throw new Error("broken");
            });
        if (phase === "sending")
            state.ws.send.mockImplementation(() => {
                throw new Error("broken");
            });
        const result = request(undefined, () => {
            throw new Error("broken");
        });
        const rejected = expect(result).rejects.toThrow("broken");
        await flush();
        if (phase === "extracting")
            state.ws.receive({ event: "spots", start_time: 10, end_time: 20 });
        await rejected;
        expect(state.ws.handlers.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });
    it("aborts an opening wait and removes its subscriber", async () => {
        state.ws.wait_for_open.mockImplementation(() => new Promise(() => {}));
        const controller = new AbortController();
        const result = request(controller.signal);
        const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
        controller.abort();
        await rejected;
        expect(state.ws.handlers.size).toBe(0);
        expect(state.ws.wait_for_open.mock.calls[0][0].aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });
});

for (const [event, hook] of [
    ["spots", useHistorySpots],
    ["propagation", useHistoryPropagation],
]) {
    describe(`${event} recovery`, () => {
        const start = new Date(Date.now() - 3_600_000);
        const end = new Date(start.getTime() + 60_000);
        function mount() {
            return renderHook(({ start, end }) => hook(start, end, 60_000, 60_000), {
                initialProps: { start, end },
            });
        }
        it("starts during connecting and retries the desired window after disconnect", async () => {
            state.ws.readyState = 0;
            state.ws.wait_for_open.mockImplementation(() => new Promise(() => {}));
            const view = mount();
            expect(state.ws.handlers.size).toBe(1);
            state.ws.readyState = 1;
            state.ws.wait_for_open.mockResolvedValue();
            view.rerender({ start, end });
            await flush();
            expect(state.ws.send).toHaveBeenCalledTimes(1);
            state.ws.readyState = 3;
            view.rerender({ start, end });
            await flush();
            expect(state.ws.handlers.size).toBe(0);
            expect(state.calls.every(call => call.signal.aborted)).toBe(true);
            const nextStart = new Date(start.getTime() + 60_000);
            const nextEnd = new Date(end.getTime() + 60_000);
            view.rerender({ start: nextStart, end: nextEnd });
            state.ws.readyState = 1;
            view.rerender({ start: nextStart, end: nextEnd });
            await flush();
            expect(state.ws.send).toHaveBeenLastCalledWith("history", {
                event,
                start_time: nextStart.getTime() / 1000,
                end_time: nextEnd.getTime() / 1000,
            });
            // A response for the old bounds cannot settle the replacement.
            state.ws.receive({
                event,
                start_time: start.getTime() / 1000,
                end_time: end.getTime() / 1000,
            });
            expect(state.ws.handlers.size).toBe(1);
        });
        it("retries unchanged bounds when the socket reopens", async () => {
            const view = mount();
            await flush();
            state.ws.readyState = 0;
            state.ws.wait_for_open.mockImplementation(() => new Promise(() => {}));
            view.rerender({ start, end });
            await flush();
            expect(state.ws.send).toHaveBeenCalledTimes(1);
            state.ws.readyState = 1;
            state.ws.wait_for_open.mockResolvedValue();
            view.rerender({ start, end });
            await flush();
            expect(state.ws.send).toHaveBeenCalledTimes(2);
            expect(state.ws.handlers.size).toBe(1);
            expect(state.calls.at(-1).signal.aborted).toBe(false);
        });
        it("coalesces window changes behind the current foreground request", async () => {
            const view = mount();
            await flush();
            for (const offset of [60_000, 120_000, 180_000]) {
                view.rerender({
                    start: new Date(start.getTime() + offset),
                    end: new Date(end.getTime() + offset),
                });
            }
            expect(state.ws.send).toHaveBeenCalledTimes(1);
            state.ws.receive({
                event,
                start_time: start.getTime() / 1000,
                end_time: end.getTime() / 1000,
                payload: [],
            });
            await flush();
            expect(state.ws.send).toHaveBeenCalledTimes(2);
            expect(state.ws.send).toHaveBeenLastCalledWith("history", {
                event,
                start_time: start.getTime() / 1000 + 180,
                end_time: end.getTime() / 1000 + 180,
            });
        });
        it.each(["leaving", "unmount"])("aborts pending work on %s", async action => {
            const view = mount();
            await flush();
            if (action === "leaving") view.rerender({ start: null, end: null });
            else view.unmount();
            await flush();
            expect(state.ws.handlers.size).toBe(0);
            expect(state.calls[0].signal.aborted).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        });
        it("releases a timed-out foreground fetch for the next window", async () => {
            vi.spyOn(console, "error").mockImplementation(() => {});
            const view = mount();
            await vi.advanceTimersByTimeAsync(HISTORY_RESPONSE_TIMEOUT_MS);
            view.rerender({
                start: new Date(start.getTime() + 60_000),
                end: new Date(end.getTime() + 60_000),
            });
            await flush();
            expect(state.ws.send).toHaveBeenCalledTimes(2);
        });
        it("does not walk the retention range after failed prefetch", async () => {
            mount();
            await flush();
            state.ws.receive({
                event,
                start_time: start.getTime() / 1000,
                end_time: end.getTime() / 1000,
                payload: [],
            });
            await flush();
            expect(state.ws.send).toHaveBeenCalledTimes(3);
            await vi.advanceTimersByTimeAsync(HISTORY_RESPONSE_TIMEOUT_MS * 3);
            expect(state.ws.send).toHaveBeenCalledTimes(3);
            expect(state.ws.handlers.size).toBe(0);
        });
    });
}

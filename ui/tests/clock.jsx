import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Clock from "@/components/Clock.jsx";
import { TimeZoneProvider } from "@/hooks/useTimeZone";

const server_clock = vi.hoisted(() => {
    const state = { value: null };
    state.now_ms = () => state.value ?? Date.now();
    return state;
});

vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({
        colors: { theme: { text: "#ffffff" } },
    }),
}));
vi.mock("@/hooks/useWs", () => ({
    useServerClock: () => server_clock,
}));

const INSTANT = new Date("2026-11-01T04:05:09Z");

function render_clock() {
    return render(
        <TimeZoneProvider>
            <Clock />
        </TimeZoneProvider>,
    );
}

beforeEach(() => {
    localStorage.clear();
    server_clock.value = null;
    vi.useFakeTimers({ now: INSTANT });
    vi.stubEnv("TZ", "Asia/Jerusalem");
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe("clock", () => {
    it("shows UTC by default", () => {
        render_clock();

        const clock = screen.getByRole("button");
        expect(clock.textContent).toBe("04:05 UTC");
        expect(clock.title).toBe("Click to show local time");
    });

    it("toggles between UTC and local time on click", () => {
        render_clock();
        const clock = screen.getByRole("button");

        fireEvent.click(clock);
        expect(clock.textContent).toBe("06:05 UTC +02:00");
        expect(clock.title).toBe("Click to show UTC");

        fireEvent.click(clock);
        expect(clock.textContent).toBe("04:05 UTC");
    });

    it("shows server time when the browser clock is wrong", () => {
        server_clock.value = Date.parse("2026-11-01T08:05:09Z");
        render_clock();

        expect(screen.getByRole("button").textContent).toBe("08:05 UTC");
    });

    it("does not depend on browser date separators", () => {
        vi.spyOn(Date.prototype, "toLocaleString").mockReturnValue("01 Nov 2026 at 04:05:09");
        render_clock();

        expect(screen.getByRole("button").textContent).toBe("04:05 UTC");
    });

    it("ticks forward", () => {
        render_clock();

        act(() => vi.advanceTimersByTime(60_000));

        expect(screen.getByRole("button").textContent).toBe("04:06 UTC");
    });

    it("creates its interval once instead of on every render", () => {
        const set_interval = vi.spyOn(globalThis, "setInterval");
        render_clock();

        act(() => vi.advanceTimersByTime(5_000));

        const clock_intervals = set_interval.mock.calls.filter(([, delay]) => delay === 1000);
        expect(clock_intervals).toHaveLength(1);
    });

    it("clears its interval on unmount", () => {
        const set_interval = vi.spyOn(globalThis, "setInterval");
        const clear_interval = vi.spyOn(globalThis, "clearInterval");
        const { unmount } = render_clock();

        unmount();

        const clock_ids = set_interval.mock.calls
            .map((call, index) => [call[1], set_interval.mock.results[index].value])
            .filter(([delay]) => delay === 1000)
            .map(([, id]) => id);
        expect(clock_ids).toHaveLength(1);
        expect(clear_interval).toHaveBeenCalledWith(clock_ids[0]);
    });
});

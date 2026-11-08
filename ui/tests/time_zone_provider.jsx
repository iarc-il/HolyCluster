import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TimeZoneProvider, useTimeZone } from "@/hooks/useTimeZone";

const INSTANT = new Date("2026-11-01T04:05:09Z");
const ZONES = ["UTC", "Asia/Jerusalem", "Asia/Kathmandu", "America/New_York"];

function use_tz(zone) {
    vi.stubEnv("TZ", zone);
}

const render_count = { current: 0 };

function Probe() {
    render_count.current += 1;
    const tz = useTimeZone();
    return (
        <div>
            <span data-testid="time-zone">{tz.time_zone}</span>
            <span data-testid="label">{tz.label}</span>
            <span data-testid="hours">{tz.hours(INSTANT)}</span>
            <span data-testid="formatted-time">{tz.format_time(INSTANT)}</span>
            <span data-testid="formatted-date">{tz.format_date(INSTANT)}</span>
            <span data-testid="offset-ms">{tz.offset_ms(INSTANT)}</span>
            <button type="button" onClick={tz.toggle_time_zone}>
                toggle
            </button>
        </div>
    );
}

function render_probe() {
    return render(
        <TimeZoneProvider>
            <Probe />
        </TimeZoneProvider>,
    );
}

function text(test_id) {
    return screen.getByTestId(test_id).textContent;
}

function toggle() {
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
}

beforeEach(() => {
    window.localStorage.clear();
    render_count.current = 0;
    vi.setSystemTime(INSTANT);
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe("time zone provider", () => {
    it("defaults to UTC regardless of the system zone", () => {
        use_tz("Pacific/Auckland");
        render_probe();

        expect(text("time-zone")).toBe("utc");
        expect(text("label")).toBe("UTC");
        expect(text("hours")).toBe("4");
        expect(text("formatted-time")).toBe("04:05");
        expect(text("formatted-date")).toBe("01 Nov");
        expect(text("offset-ms")).toBe("0");
    });

    it("toggles between UTC and local", () => {
        use_tz("Asia/Jerusalem");
        render_probe();

        toggle();
        expect(text("time-zone")).toBe("local");
        expect(text("hours")).toBe("6");

        toggle();
        expect(text("time-zone")).toBe("utc");
        expect(text("hours")).toBe("4");
    });

    it("persists the choice across remounts", () => {
        render_probe();
        toggle();
        cleanup();

        render_probe();
        expect(text("time-zone")).toBe("local");
    });

    it("starts in local mode when stored", () => {
        window.localStorage.setItem("time_zone", JSON.stringify("local"));
        render_probe();

        expect(text("time-zone")).toBe("local");
    });

    it("throws outside the provider", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});

        expect(() => render(<Probe />)).toThrow(
            "useTimeZone must be used within a TimeZoneProvider",
        );
    });
});

describe("time zone formatting", () => {
    it.each(
        ZONES.flatMap(zone => [
            [zone, "utc"],
            [zone, "local"],
        ]),
    )("uses fixed layouts in %s (%s mode)", (zone, mode) => {
        use_tz(zone);
        window.localStorage.setItem("time_zone", JSON.stringify(mode));
        render_probe();

        expect(text("formatted-time")).toMatch(/^\d{2}:\d{2}$/);
        expect(text("formatted-date")).toMatch(/^\d{2} [A-Z][a-z]{2}$/);
    });
});

describe("local time values", () => {
    it.each([
        ["Asia/Jerusalem", "6", "06:05", "UTC +02:00", 2 * 3_600_000],
        ["Asia/Kathmandu", "9", "09:50", "UTC +05:45", 5.75 * 3_600_000],
        ["America/New_York", "0", "00:05", "UTC -04:00", -4 * 3_600_000],
    ])("formats %s", (zone, hours, hhmm, label, offset_ms) => {
        use_tz(zone);
        window.localStorage.setItem("time_zone", JSON.stringify("local"));
        render_probe();

        expect(text("hours")).toBe(hours);
        expect(text("formatted-time")).toBe(hhmm);
        expect(text("label")).toBe(label);
        expect(Number(text("offset-ms"))).toBe(offset_ms);
    });

    it("uses the offset in effect at each date across DST", () => {
        use_tz("Europe/London");
        window.localStorage.setItem("time_zone", JSON.stringify("local"));
        let tz;
        function Capture() {
            tz = useTimeZone();
            return null;
        }
        render(
            <TimeZoneProvider>
                <Capture />
            </TimeZoneProvider>,
        );

        expect(tz.offset_ms(new Date("2026-01-15T12:00:00Z"))).toBe(0);
        expect(tz.offset_ms(new Date("2026-07-15T12:00:00Z"))).toBe(3_600_000);
    });
});

describe("time zone offset polling", () => {
    beforeEach(() => {
        vi.useFakeTimers({ now: INSTANT });
        use_tz("Asia/Jerusalem");
        window.localStorage.setItem("time_zone", JSON.stringify("local"));
    });

    it("does not re-render when the offset is unchanged", () => {
        render_probe();
        const renders_before = render_count.current;

        act(() => vi.advanceTimersByTime(5 * 60_000));

        expect(render_count.current).toBe(renders_before);
    });

    it.each([
        ["the poll interval", () => vi.advanceTimersByTime(60_000)],
        ["window focus", () => window.dispatchEvent(new Event("focus"))],
        ["visibility change", () => document.dispatchEvent(new Event("visibilitychange"))],
    ])("picks up a new offset on %s", (_name, trigger) => {
        render_probe();
        expect(text("label")).toBe("UTC +02:00");

        vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-180);
        act(trigger);

        expect(text("label")).toBe("UTC +03:00");
    });

    it("cleans up its timer and listeners on unmount", () => {
        const set_interval = vi.spyOn(globalThis, "setInterval");
        const clear_interval = vi.spyOn(globalThis, "clearInterval");
        const window_remove = vi.spyOn(window, "removeEventListener");
        const document_remove = vi.spyOn(document, "removeEventListener");
        const { unmount } = render_probe();

        unmount();

        const interval_ids = set_interval.mock.results.map(result => result.value);
        expect(interval_ids.length).toBeGreaterThan(0);
        for (const id of interval_ids) {
            expect(clear_interval).toHaveBeenCalledWith(id);
        }
        expect(window_remove).toHaveBeenCalledWith("focus", expect.any(Function));
        expect(document_remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    });
});

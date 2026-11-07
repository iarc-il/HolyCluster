import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HistoryBar from "@/components/history/HistoryBar.jsx";
import { TimeZoneProvider, useTimeZone } from "@/hooks/useTimeZone";

const test_state = vi.hoisted(() => ({ display_hours: 24 }));

vi.mock("@/hooks/useWs", () => ({
    useServerClock: () => ({ now_ms: () => Date.now() }),
}));

vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({
        colors: {
            buttons: { utility: "#ffffff" },
            theme: {
                background: "#000000",
                borders: "#444444",
                columns: "#111111",
                input_background: "#222222",
                modals: "#333333",
                text: "#ffffff",
            },
        },
    }),
}));

vi.mock("@/hooks/useProfiles.jsx", () => ({
    useProfiles: () => ({
        active_profile_data: {
            history: {
                display_hours: test_state.display_hours,
                time_between_shifts: 1,
                step_size_ms: 60_000,
            },
        },
        update_active_profile_section: vi.fn(),
    }),
}));

const INSTANT = new Date("2026-11-01T04:05:09Z");
const HOUR_MS = 3_600_000;

function Toggle() {
    const { toggle_time_zone } = useTimeZone();
    return (
        <button type="button" onClick={toggle_time_zone}>
            toggle zone
        </button>
    );
}

function render_bar({ zone, mode = "utc", display_hours, now = INSTANT }) {
    vi.stubEnv("TZ", zone);
    test_state.display_hours = display_hours;
    vi.setSystemTime(now);
    localStorage.setItem("time_zone", JSON.stringify(mode));

    const end = new Date(now);
    const start = new Date(now.getTime() - HOUR_MS);
    return render(
        <TimeZoneProvider>
            <Toggle />
            <HistoryBar
                start={start}
                end={end}
                set_start={vi.fn()}
                set_end={vi.fn()}
                window_size_ms={HOUR_MS}
                set_window_size_ms={vi.fn()}
                set_is_dragging={vi.fn()}
            />
        </TimeZoneProvider>,
    );
}

function get_ticks() {
    return screen.getAllByTestId("history-tick-label").map(element => ({
        text: element.textContent,
        left: Number.parseFloat(element.style.left),
    }));
}

function get_labels() {
    return get_ticks().map(tick => tick.text);
}

function is_hhmm(label) {
    return /^\d{2}:\d{2}$/.test(label);
}

function is_date(label) {
    return /^\d{2} [A-Z][a-z]{2}$/.test(label);
}

function hour_of(label) {
    return Number(label.slice(0, 2));
}

function expected_left(ms, now, display_hours) {
    const bar_start_ms = now.getTime() - display_hours * HOUR_MS;
    return ((ms - bar_start_ms) / (display_hours * HOUR_MS)) * 100;
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

describe("history bar labels in UTC", () => {
    it("labels hourly ticks over 24h including midnight", () => {
        render_bar({ zone: "Europe/Moscow", display_hours: 24 });

        const labels = get_labels();
        expect(labels).toHaveLength(24);
        expect(labels.every(label => /^\d{2}:00$/.test(label))).toBe(true);
        expect(labels).toContain("00:00");
    });

    it("shows a date label at UTC midnight over 48h", () => {
        render_bar({ zone: "Europe/Moscow", display_hours: 48 });

        const dates = get_ticks().filter(tick => is_date(tick.text));
        expect(dates.map(tick => tick.text)).toEqual(["31 Oct", "01 Nov"]);
        expect(dates[1].left).toBeCloseTo(
            expected_left(Date.parse("2026-11-01T00:00:00Z"), INSTANT, 48),
        );
    });
});

describe("history bar labels in local time", () => {
    it("aligns 2h ticks to local midnight in an odd-hour zone", () => {
        render_bar({ zone: "Europe/Moscow", mode: "local", display_hours: 48 });

        const labels = get_labels();
        const times = labels.filter(is_hhmm);
        expect(times.every(label => label.endsWith(":00") && hour_of(label) % 2 === 0)).toBe(true);
        expect(labels.filter(is_date)).toEqual(["31 Oct", "01 Nov"]);
    });

    it.each([24, 48])("keeps labels on the hour in a +5:45 zone over %ih", display_hours => {
        render_bar({ zone: "Asia/Kathmandu", mode: "local", display_hours });

        const times = get_labels().filter(is_hhmm);
        expect(times.length).toBeGreaterThan(0);
        expect(times.every(label => label.endsWith(":00"))).toBe(true);
    });

    it("places the date separator at local midnight", () => {
        render_bar({ zone: "Europe/Moscow", mode: "local", display_hours: 48 });

        const first_of_november = get_ticks().find(tick => tick.text === "01 Nov");
        // Midnight in Moscow (UTC+3) is 21:00 UTC the day before
        expect(first_of_november.left).toBeCloseTo(
            expected_left(Date.parse("2026-10-31T21:00:00Z"), INSTANT, 48),
        );
        expect(first_of_november.left).not.toBeCloseTo(
            expected_left(Date.parse("2026-11-01T00:00:00Z"), INSTANT, 48),
        );
    });

    it("keeps minor ticks off major tick positions", () => {
        render_bar({ zone: "Europe/Moscow", mode: "local", display_hours: 48 });

        const major_lefts = get_ticks().map(tick => tick.left.toFixed(3));
        const minor_lefts = screen
            .getAllByTestId("history-minor-tick")
            .map(element => Number.parseFloat(element.style.left).toFixed(3));

        expect(minor_lefts.some(left => major_lefts.includes(left))).toBe(false);
        expect(major_lefts.length + minor_lefts.length).toBe(48);
    });

    it("relabels ticks when the zone is toggled", () => {
        render_bar({ zone: "Europe/Moscow", display_hours: 24 });
        expect(get_labels().at(-1)).toBe("04:00");

        fireEvent.click(screen.getByRole("button", { name: "toggle zone" }));

        expect(get_labels().at(-1)).toBe("07:00");
    });

    // Known behaviour, not a goal: ticks are aligned using the offset at the start of the bar,
    // so after a DST change inside the window they land on odd local hours. Update this test
    // deliberately if the alignment is changed to re-align after a transition.
    it("keeps the bar-start alignment across a DST change", () => {
        const now = new Date("2026-10-25T12:00:00Z");
        render_bar({ zone: "Europe/London", mode: "local", display_hours: 48, now });

        const labels = get_labels();
        const change_index = labels.indexOf("25 Oct");
        expect(change_index).toBeGreaterThan(0);

        const before = labels.slice(0, change_index).filter(is_hhmm);
        const after = labels.slice(change_index + 1).filter(is_hhmm);
        expect(before.every(label => hour_of(label) % 2 === 0)).toBe(true);
        expect(after.length).toBeGreaterThan(0);
        expect(after.every(label => hour_of(label) % 2 === 1)).toBe(true);
    });
});

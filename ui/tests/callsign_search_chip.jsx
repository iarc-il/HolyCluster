import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import CallsignSearchChip from "@/components/search/CallsignSearchChip.jsx";
import { TimeZoneProvider } from "@/hooks/useTimeZone";

const test_state = vi.hoisted(() => ({ spot_data: null }));

vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({ colors: { theme: { text: "#ffffff", modals: "#000000" } } }),
}));
vi.mock("@/hooks/useSpotInteraction", () => ({
    useSpotInteraction: () => ({ search_query: "" }),
}));
vi.mock("@/hooks/useSpotData", () => ({
    useSpotData: () => test_state.spot_data,
}));

function render_chip(search, overrides = {}, props = {}) {
    test_state.spot_data = {
        callsign_search: search && { callsign: "K3ABC", ...search },
        set_callsign_search: vi.fn(),
        search_fetch_state: "done",
        search_error: null,
        search_truncated: false,
        spots: [],
        raw_spots: [],
        ...overrides,
    };
    // The real provider, so the chip uses the formatters it actually exposes
    return render(
        <TimeZoneProvider>
            <CallsignSearchChip {...props} />
        </TimeZoneProvider>,
    );
}

const PRESET_SEARCH = {
    start: new Date(Date.UTC(2026, 0, 1)),
    end: new Date(Date.UTC(2026, 0, 3)),
    from_preset: "2d",
    to_preset: "now",
};

describe("CallsignSearchChip", () => {
    afterEach(() => {
        cleanup();
        localStorage.clear();
    });

    it("renders nothing without an active search", () => {
        const { container } = render_chip(null);
        expect(container.textContent).toBe("");
    });

    it("summarizes a preset range ending now", () => {
        render_chip(PRESET_SEARCH, { spots: [{}, {}], raw_spots: [{}, {}] });

        expect(screen.getByText("K3ABC")).toBeTruthy();
        expect(screen.getByText("· Last 2 days")).toBeTruthy();
        expect(screen.getByText("(2)")).toBeTruthy();
    });

    it("shows Custom for a custom range and the exact range in the tooltip", () => {
        render_chip({
            start: new Date(Date.UTC(2026, 0, 1, 8, 30)),
            end: new Date(Date.UTC(2026, 0, 3, 17, 5)),
            from_preset: "custom",
            to_preset: "custom",
        });

        expect(screen.getByText("· Custom")).toBeTruthy();

        fireEvent.mouseEnter(document.querySelector("[data-tour='callsign-search-chip']"));
        expect(screen.getByRole("tooltip").textContent).toMatch(
            /01 Jan 08:30 – 03 Jan 17:05 \(UTC\)/,
        );
    });

    it("hides the range in compact mode", () => {
        render_chip(PRESET_SEARCH, {}, { compact: true });

        expect(screen.getByText("K3ABC")).toBeTruthy();
        expect(screen.queryByText("· Last 2 days")).toBeNull();
    });

    it("puts the truncation warning in the tooltip", () => {
        render_chip(PRESET_SEARCH, {
            search_truncated: true,
            raw_spots: new Array(10_000).fill({}),
        });

        const chip = document.querySelector("[data-tour='callsign-search-chip']");
        expect(screen.queryByRole("tooltip")).toBeNull();

        fireEvent.mouseEnter(chip);
        expect(screen.getByRole("tooltip").textContent).toMatch(/Showing newest 10,000 spots/);

        fireEvent.mouseLeave(chip);
        expect(screen.queryByRole("tooltip")).toBeNull();
    });

    it("exits the search", () => {
        render_chip(PRESET_SEARCH);

        fireEvent.click(screen.getByRole("button", { name: "Exit callsign search" }));
        expect(test_state.spot_data.set_callsign_search).toHaveBeenCalledWith(null);
    });
});

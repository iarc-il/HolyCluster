import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import CallsignHistoryLauncher from "@/components/search/CallsignHistoryLauncher.jsx";
import CallsignSearchModal from "@/components/search/CallsignSearchModal.jsx";
import { view_callsign_history } from "@/hooks/useCallsignSearch";
import { TimeZoneProvider } from "@/hooks/useTimeZone";

const test_state = vi.hoisted(() => ({ spot_data: null, search_query: "" }));

vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({
        colors: { theme: { text: "#ffffff", modals: "#000000", borders: "#333333" } },
    }),
}));
vi.mock("@/hooks/useUiRefresh.jsx", () => ({ useUiRefreshBlocker: () => {} }));
vi.mock("@/hooks/useSpotInteraction", () => ({
    useSpotInteraction: () => ({ search_query: test_state.search_query }),
}));
vi.mock("@/hooks/useSpotData", () => ({
    useSpotData: () => test_state.spot_data,
}));

function render_modal(props = {}) {
    // No active search, as after the user exits one
    test_state.spot_data = { callsign_search: null, set_callsign_search: vi.fn() };
    render(
        <TimeZoneProvider>
            <CallsignSearchModal button={<span>Open search</span>} {...props} />
        </TimeZoneProvider>,
    );
}

function open_modal() {
    fireEvent.click(screen.getByText("Open search"));
}

function selects() {
    const [from, to] = screen.getAllByRole("combobox");
    return { from, to };
}

describe("CallsignSearchModal", () => {
    afterEach(() => {
        cleanup();
        localStorage.clear();
        test_state.search_query = "";
    });

    it("defaults to the last day until now", () => {
        render_modal();
        open_modal();

        expect(selects().from.value).toBe("1d");
        expect(selects().to.value).toBe("now");
    });

    it("remembers the last presets but not the callsign", () => {
        render_modal();
        open_modal();
        fireEvent.change(screen.getByRole("textbox"), { target: { value: "k3abc" } });
        fireEvent.change(selects().from, { target: { value: "1w" } });
        fireEvent.click(screen.getByText("Search"));

        expect(test_state.spot_data.set_callsign_search).toHaveBeenCalledWith(
            expect.objectContaining({ callsign: "K3ABC", from_preset: "1w", to_preset: "now" }),
        );

        open_modal();
        expect(screen.getByRole("textbox").value).toBe("");
        expect(selects().from.value).toBe("1w");
        expect(selects().to.value).toBe("now");
    });

    it("remembers a custom range", () => {
        render_modal();
        open_modal();
        fireEvent.change(screen.getByRole("textbox"), { target: { value: "K3ABC" } });
        fireEvent.change(selects().from, { target: { value: "custom" } });
        fireEvent.change(selects().to, { target: { value: "custom" } });
        fireEvent.change(screen.getByLabelText("From (UTC) date"), {
            target: { value: "2026-01-01" },
        });
        fireEvent.change(screen.getByLabelText("From (UTC) time"), { target: { value: "08:30" } });
        fireEvent.change(screen.getByLabelText("To (UTC) date"), {
            target: { value: "2026-01-03" },
        });
        fireEvent.change(screen.getByLabelText("To (UTC) time"), { target: { value: "17:05" } });
        fireEvent.click(screen.getByText("Search"));

        open_modal();
        expect(screen.getByLabelText("From (UTC) date").value).toBe("2026-01-01");
        expect(screen.getByLabelText("From (UTC) time").value).toBe("08:30");
        expect(screen.getByLabelText("To (UTC) date").value).toBe("2026-01-03");
        expect(screen.getByLabelText("To (UTC) time").value).toBe("17:05");
    });

    it("prefills the callsign from the table's search box", () => {
        test_state.search_query = " k3abc ";
        render_modal();
        open_modal();

        expect(screen.getByRole("textbox").value).toBe("K3ABC");
    });

    it("prefers the dx prop over the search box", () => {
        test_state.search_query = "K3ABC";
        render_modal({ dx: "W1AW" });
        open_modal();

        expect(screen.getByRole("textbox").value).toBe("W1AW");
    });

    it("opens prefilled from view_callsign_history", () => {
        test_state.spot_data = { callsign_search: null, set_callsign_search: vi.fn() };
        render(
            <TimeZoneProvider>
                <CallsignHistoryLauncher />
            </TimeZoneProvider>,
        );
        expect(screen.queryByRole("dialog")).toBeNull();

        act(() => view_callsign_history("ja1abc"));
        expect(screen.getByRole("dialog")).toBeTruthy();
        expect(screen.getByRole("textbox").value).toBe("JA1ABC");

        fireEvent.click(screen.getByText("Cancel"));
        act(() => view_callsign_history("JA1ABC"));
        expect(screen.getByRole("textbox").value).toBe("JA1ABC");
    });

    it("ignores an unrecognized saved range", () => {
        localStorage.setItem("callsign_search_range", JSON.stringify({ from_preset: "1y" }));
        render_modal();
        open_modal();

        expect(selects().from.value).toBe("1d");
        expect(selects().to.value).toBe("now");
    });
});

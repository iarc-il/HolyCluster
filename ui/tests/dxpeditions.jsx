import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DXpeditions from "@/components/DXpeditions.jsx";

const test_state = vi.hoisted(() => ({
    dxpeditions: [],
    panels: {
        dxpeditions_filter: "all",
        dxpeditions_sort: "end",
    },
    set_hovered_spot: vi.fn(),
    spots: [],
    update_active_profile_section: vi.fn(),
}));

vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({
        colors: {
            dxpeditions: {
                borders: "#334155",
                progress_bar: "#60a5fa",
                progress_track: "#1e293b",
            },
            theme: {
                background: "#0f172a",
                columns: "#111827",
                text: "#f8fafc",
            },
        },
    }),
}));

vi.mock("@/hooks/useProfiles.jsx", () => ({
    useProfiles: () => ({
        active_profile_data: {
            panels: test_state.panels,
        },
        update_active_profile_section: test_state.update_active_profile_section,
    }),
}));

vi.mock("@/hooks/useRestData", () => ({
    useRestData: () => ({ dxpeditions: test_state.dxpeditions }),
}));

vi.mock("@/hooks/useSpotData", () => ({
    useSpotData: () => ({ spots: test_state.spots }),
}));

vi.mock("@/hooks/useSpotInteraction", () => ({
    useSpotInteraction: () => ({
        hovered_spot: { id: null, source: null },
        set_hovered_spot: test_state.set_hovered_spot,
    }),
}));

describe("DXpeditions", () => {
    afterEach(() => {
        cleanup();
        test_state.dxpeditions = [];
        test_state.spots = [];
        test_state.panels = {
            dxpeditions_filter: "all",
            dxpeditions_sort: "end",
        };
        vi.clearAllMocks();
    });

    it("keeps tour anchors visible in the empty state", () => {
        const { container } = render(<DXpeditions />);

        expect(screen.getByText("No active DXpeditions")).not.toBeNull();
        expect(container.querySelector("[data-tour='dxpeditions-panel']")).not.toBeNull();
        expect(container.querySelector("[data-tour='dxpeditions-summary']")).not.toBeNull();
        expect(container.querySelector("[data-tour='dxpeditions-filter']")).not.toBeNull();
        expect(container.querySelector("[data-tour='dxpeditions-sort']")).not.toBeNull();
    });

    it("inserts the on-air marker after browser translation changes the callsign text", () => {
        test_state.dxpeditions = [
            {
                id: 1,
                callsign: "K1ABC",
                start_date: "2026-01-01T00:00:00Z",
                end_date: "2099-01-01T00:00:00Z",
            },
        ];
        const { rerender } = render(<DXpeditions />);
        const callsign = screen.getByText("K1ABC");
        const text = [...callsign.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
        const translated = document.createElement("font");
        translated.textContent = text.textContent;
        callsign.replaceChild(translated, text);
        test_state.spots = [
            {
                id: 2,
                dx_callsign: "K1ABC",
                is_dxpedition: true,
                time: "2026-10-17T00:00:00Z",
            },
        ];

        expect(() => rerender(<DXpeditions />)).not.toThrow();
        expect(screen.getByText("⭐")).not.toBeNull();
    });
});

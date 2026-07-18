import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import MapControls from "@/components/MapControls.jsx";
import { TOUR_CLOSE_MAP_CONTROLS_EVENT } from "@/components/tour/tour_events.js";

vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({
        dev_mode: false,
        colors: {
            buttons: {
                disabled: "#777777",
                utility: "#ffffff",
            },
            map_controls: {
                zone_label_inactive: "#999999",
            },
            theme: {
                background: "#000000",
                text: "#ffffff",
            },
        },
    }),
}));

vi.mock("@/hooks/useFilters", () => ({
    useFilters: () => ({
        filters: {},
        setFilters: vi.fn(),
    }),
}));

vi.mock("@/hooks/useRadio", () => ({
    default: () => ({
        radio_status: "unavailable",
    }),
}));

vi.mock("@/hooks/useRestData", () => ({
    useRestData: () => ({
        propagation: null,
    }),
}));

vi.mock("@/hooks/useSettings", () => ({
    useSettings: () => ({
        settings: {
            default_radius: 12000,
            locator: "FN20",
            propagation_displayed: false,
        },
    }),
}));

function render_map_controls() {
    const map_controls = {
        location: {
            displayed_locator: "JJ00AA",
            location: [0, 0],
        },
    };

    return render(
        <MapControls
            map_controls={map_controls}
            set_map_controls={vi.fn(change_func => change_func(map_controls))}
            set_radius_in_km={vi.fn()}
            auto_toggle_radius={false}
            can_undo_cat={false}
            undo_cat={vi.fn()}
            is_map_fullscreen={false}
            toggle_map_fullscreen={vi.fn()}
            is_mobile={false}
            is_history_mode={false}
            toggle_history={vi.fn()}
        />,
    );
}

describe("MapControls tour integration", () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it("closes the controls panel when the map tour finishes", async () => {
        const user = userEvent.setup();
        const { container } = render_map_controls();

        await user.click(screen.getByRole("button", { name: "Show map controls" }));

        expect(container.querySelector("[data-tour='map-controls-panel']")).not.toBeNull();

        document.dispatchEvent(new Event(TOUR_CLOSE_MAP_CONTROLS_EVENT));

        await waitFor(() => {
            expect(container.querySelector("[data-tour='map-controls-panel']")).toBeNull();
        });
    });
});

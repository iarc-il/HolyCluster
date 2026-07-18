import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import MapControls from "@/components/MapControls.jsx";

vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({
        dev_mode: false,
        colors: {
            buttons: {
                active: "#3b82f6",
                disabled: "#777777",
                utility: "#ffffff",
            },
            map_controls: {
                radio_connected: "#00ff00",
                radio_disconnected: "#ff0000",
                radio_unknown: "#777777",
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

function set_geolocation(getCurrentPosition) {
    Object.defineProperty(window.navigator, "geolocation", {
        configurable: true,
        value: getCurrentPosition == null ? undefined : { getCurrentPosition },
    });
}

function render_map_controls({ is_mobile }) {
    const map_controls = {
        location: {
            displayed_locator: "JJ00AA",
            location: [0, 0],
        },
    };
    const set_map_controls = vi.fn(change_func => change_func(map_controls));

    const render_result = render(
        <MapControls
            map_controls={map_controls}
            set_map_controls={set_map_controls}
            set_radius_in_km={vi.fn()}
            auto_toggle_radius={false}
            can_undo_cat={false}
            undo_cat={vi.fn()}
            is_map_fullscreen={false}
            toggle_map_fullscreen={vi.fn()}
            is_mobile={is_mobile}
            is_history_mode={false}
            toggle_history={vi.fn()}
        />,
    );

    return { ...render_result, map_controls, set_map_controls };
}

describe("MapControls GPS", () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        set_geolocation(null);
    });

    it("centers the mobile map on the current GPS location", async () => {
        const user = userEvent.setup();
        const getCurrentPosition = vi.fn(success => {
            success({ coords: { latitude: 40, longitude: -75 } });
        });
        set_geolocation(getCurrentPosition);
        const { map_controls, set_map_controls } = render_map_controls({ is_mobile: true });

        await user.click(
            screen.getByRole("button", { name: "Center map on current GPS location" }),
        );

        await waitFor(() => {
            expect(set_map_controls).toHaveBeenCalled();
            expect(map_controls.location).toEqual({
                displayed_locator: "FN20MA",
                location: [-75, 40],
            });
        });
    });

    it("does not show the GPS button on desktop", () => {
        render_map_controls({ is_mobile: false });

        expect(
            screen.queryByRole("button", { name: "Center map on current GPS location" }),
        ).toBeNull();
    });

    it("keeps the controls panel open when clicking the tour tooltip", async () => {
        const user = userEvent.setup();
        const { container } = render_map_controls({ is_mobile: false });
        const portal = document.createElement("div");
        const tooltip_button = document.createElement("button");
        portal.id = "react-joyride-portal";
        portal.append(tooltip_button);
        document.body.append(portal);

        await user.click(screen.getByRole("button", { name: "Show map controls" }));

        expect(container.querySelector("[data-tour='map-controls-panel']")).not.toBeNull();

        fireEvent.mouseDown(tooltip_button);

        expect(container.querySelector("[data-tour='map-controls-panel']")).not.toBeNull();

        fireEvent.mouseDown(document.body);

        await waitFor(() => {
            expect(container.querySelector("[data-tour='map-controls-panel']")).toBeNull();
        });
    });
});

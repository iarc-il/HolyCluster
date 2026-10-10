import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    build_spot_context_filter,
    build_spot_context_menu_actions,
} from "@/components/CanvasMap/map_context_menu.js";
import { useMapGestures } from "@/components/CanvasMap/useMapGestures.js";
import SpotContextMenu from "@/components/SpotContextMenu.jsx";

vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({
        colors: {
            buttons: { active_tab: "#222222" },
            theme: { background: "#000000", border: "#333333", text: "#ffffff" },
        },
    }),
}));

function MapGestureHarness({ get_data_from_shadow_canvas, open_spot_context_menu }) {
    const shadow_canvas_ref = useRef(document.createElement("canvas"));
    const projection_ref = useRef({});
    const hit_test_ref = useRef();
    hit_test_ref.current = {
        get_data_from_shadow_canvas,
        get_clickable_zone_label: () => null,
        get_clickable_dxcc_label: () => null,
    };
    const render_state_ref = useRef({
        spots: [{ id: 1, dx_callsign: "K1ABC" }],
        map_controls: { is_globe: false },
        hovered_spot: { id: null, source: null },
        hovered_zone: { system: null, number: null },
        hovered_dxcc: null,
    });

    const { container_ref } = useMapGestures({
        dims: { center_x: 50, center_y: 50, radius: 50 },
        projection_ref,
        base_scale_ref: useRef(1),
        canvas_refs: { shadow_canvas_ref },
        render_state_ref,
        gesture_active_ref: useRef(false),
        hit_test_ref,
        set_auto_radius: vi.fn(),
        set_radius_in_km: vi.fn(),
        set_hovered_zone: vi.fn(),
        set_hovered_dxcc: vi.fn(),
        callbacks: {
            set_map_controls: vi.fn(),
            set_cat_to_spot: vi.fn(),
            set_hovered_spot: vi.fn(),
            set_pinned_spot: vi.fn(),
            add_filter_if_allowed: vi.fn(),
            open_zone_context_menu: vi.fn(),
            open_dxcc_context_menu: vi.fn(),
            open_spot_context_menu,
        },
    });

    return (
        <div ref={container_ref}>
            <svg data-testid="map-overlay" />
        </div>
    );
}

describe("map spot context menu", () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it("adds a DX callsign filter through the shared filter action", async () => {
        const user = userEvent.setup();
        const get_filter_add_status = vi.fn(() => ({ status: "add" }));
        const add_filter_if_allowed = vi.fn();
        const spot = { id: 1, dx_callsign: "K1ABC" };

        render(
            <SpotContextMenu
                x={10}
                y={10}
                spot={spot}
                on_close={vi.fn()}
                actions={build_spot_context_menu_actions(
                    spot,
                    get_filter_add_status,
                    add_filter_if_allowed,
                )}
            />,
        );

        await user.click(screen.getByRole("button", { name: "Add Hide K1ABC" }));

        expect(add_filter_if_allowed).toHaveBeenCalledWith({
            action: "hide",
            type: "prefix",
            value: "K1ABC",
            spotter_or_dx: "dx",
        });
    });

    it("disables filters for malformed spot data", () => {
        const get_filter_add_status = vi.fn();
        const add_filter_if_allowed = vi.fn();
        const actions = build_spot_context_menu_actions(
            { id: 1, dx_callsign: "  " },
            get_filter_add_status,
            add_filter_if_allowed,
        );

        render(
            <SpotContextMenu
                x={10}
                y={10}
                spot={{ id: 1, dx_callsign: "  " }}
                on_close={vi.fn()}
                actions={actions}
            />,
        );

        expect(
            screen.getByRole("button", { name: /Add Alert/ }).getAttribute("aria-disabled"),
        ).toBe("true");
        expect(screen.getAllByText("(Missing DX callsign)")).toHaveLength(3);
        expect(get_filter_add_status).not.toHaveBeenCalled();
        expect(build_spot_context_filter("hide", { dx_callsign: 42 }).value).toBeNull();
    });

    it("opens for a spot below a map overlay and preserves the native menu elsewhere", () => {
        const open_spot_context_menu = vi.fn();
        const { rerender } = render(
            <MapGestureHarness
                get_data_from_shadow_canvas={() => ["dx", 1]}
                open_spot_context_menu={open_spot_context_menu}
            />,
        );
        const overlay = screen.getByTestId("map-overlay");
        const spot_event = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: 25,
            clientY: 30,
        });

        overlay.dispatchEvent(spot_event);

        expect(spot_event.defaultPrevented).toBe(true);
        expect(open_spot_context_menu).toHaveBeenCalledWith(25, 30, {
            id: 1,
            dx_callsign: "K1ABC",
        });

        rerender(
            <MapGestureHarness
                get_data_from_shadow_canvas={() => null}
                open_spot_context_menu={open_spot_context_menu}
            />,
        );
        const empty_event = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: 25,
            clientY: 30,
        });

        screen.getByTestId("map-overlay").dispatchEvent(empty_event);

        expect(empty_event.defaultPrevented).toBe(false);
        expect(open_spot_context_menu).toHaveBeenCalledTimes(1);
    });
});

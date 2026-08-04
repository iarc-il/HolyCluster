import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    build_spot_context_filter,
    build_spot_context_menu_actions,
} from "@/components/CanvasMap/map_context_menu.js";
import SpotContextMenu from "@/components/SpotContextMenu.jsx";

vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({
        colors: {
            buttons: { active_tab: "#222222" },
            theme: { background: "#000000", border: "#333333", text: "#ffffff" },
        },
    }),
}));

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
});

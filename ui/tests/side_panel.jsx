import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("virtual:cty-dxcc-entities", () => ({
    default: ["United States", "Canada"],
    dxcc_entities_by_code: {
        1: { code: 1, raw_cty_name: "Canada", continent: "NA" },
        291: { code: 291, raw_cty_name: "United States", continent: "NA" },
    },
    dxcc_code_entities: { 1: "Canada", 291: "United States" },
}));

vi.mock("@/components/MissingPanel.jsx", () => ({
    default: ({ on_import_complete }) => (
        <button type="button" onClick={on_import_complete}>
            Complete import
        </button>
    ),
}));

vi.mock("@/components/FilterOptions.jsx", () => ({ default: ({ children }) => children }));
vi.mock("@/components/UtilityButtons", () => ({ default: () => null }));

import SidePanel from "@/components/SidePanel.jsx";
import { ColorsProvider } from "@/hooks/useColors.jsx";
import { FiltersProvider } from "@/hooks/useFilters.jsx";
import { ProfilesProvider } from "@/hooks/useProfiles.jsx";
import {
    PROFILE_STORE_KEY,
    PROFILE_STORE_VERSION,
    create_default_profile_data,
} from "@/utils/profile_data.js";

function SidePanelHarness() {
    const [toggled_ui, set_toggled_ui] = useState({ right_visible: false });
    const [active_view, set_active_view] = useState(4);

    return (
        <>
            <output data-testid="right-panel-state">
                {toggled_ui.right_visible ? "open" : "closed"}
            </output>
            <SidePanel
                toggled_ui={toggled_ui}
                set_toggled_ui={set_toggled_ui}
                set_cat_to_spot={() => {}}
                active_view={active_view}
                set_active_view={set_active_view}
            />
        </>
    );
}

function render_side_panel() {
    window.localStorage.setItem(
        PROFILE_STORE_KEY,
        JSON.stringify({
            version: PROFILE_STORE_VERSION,
            active_profile_name: "Default",
            profiles: [{ name: "Default", data: create_default_profile_data() }],
        }),
    );

    return render(
        <MemoryRouter>
            <ProfilesProvider>
                <ColorsProvider>
                    <FiltersProvider>
                        <SidePanelHarness />
                    </FiltersProvider>
                </ColorsProvider>
            </ProfilesProvider>
        </MemoryRouter>,
    );
}

describe("SidePanel", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        window.localStorage.clear();
    });

    it("keeps the Missing panel open without opening a filter modal after an import", async () => {
        const user = userEvent.setup();
        render_side_panel();

        expect(screen.getByTestId("right-panel-state").textContent).toBe("closed");
        await user.click(screen.getByRole("button", { name: "Complete import" }));

        expect(screen.getByTestId("right-panel-state").textContent).toBe("open");
        expect(screen.getByRole("button", { name: "Missing" }).getAttribute("aria-pressed")).toBe(
            "true",
        );
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});

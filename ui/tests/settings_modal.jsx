import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Settings } from "@/components/settings/Settings.jsx";
import { ColorsProvider } from "@/hooks/useColors.jsx";
import { FiltersProvider } from "@/hooks/useFilters.jsx";
import { ProfilesProvider } from "@/hooks/useProfiles.jsx";
import { SettingsProvider } from "@/hooks/useSettings.jsx";
import { PROFILE_STORE_KEY } from "@/utils/profile_data.js";

vi.mock("@/hooks/useRadio", () => ({
    default: () => ({
        is_radio_available: () => false,
    }),
}));

function render_settings_modal() {
    const map_controls = {
        location: {
            displayed_locator: "JJ00AA",
            location: [0, 0],
        },
    };
    const set_radius_in_km = vi.fn();

    const result = render(
        <MemoryRouter>
            <ProfilesProvider>
                <ColorsProvider>
                    <FiltersProvider>
                        <SettingsProvider>
                            <Settings
                                set_map_controls={change_func => change_func(map_controls)}
                                set_radius_in_km={set_radius_in_km}
                            />
                        </SettingsProvider>
                    </FiltersProvider>
                </ColorsProvider>
            </ProfilesProvider>
        </MemoryRouter>,
    );

    return { ...result, map_controls, set_radius_in_km };
}

describe("settings modal", () => {
    beforeEach(() => {
        Object.defineProperty(window, "matchMedia", {
            writable: true,
            value: vi.fn().mockImplementation(query => ({
                matches: false,
                media: query,
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            })),
        });
        window.localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        window.localStorage.clear();
    });

    it("applies general settings to the active profile", async () => {
        const user = userEvent.setup();
        const { container, map_controls, set_radius_in_km } = render_settings_modal();

        await user.click(container.querySelector(".cursor-pointer"));

        const inputs = document.body.querySelectorAll("input");
        const callsign_input = inputs[0];
        const locator_input = inputs[1];
        const radius_input = inputs[2];

        await user.type(callsign_input, "n0call");
        await user.type(locator_input, "FN20");
        await user.clear(radius_input);
        await user.type(radius_input, "12000");
        await user.selectOptions(document.body.querySelectorAll("select")[1], "true");
        await user.click(screen.getByText("Apply"));

        await waitFor(() => {
            const store = JSON.parse(window.localStorage.getItem(PROFILE_STORE_KEY));
            expect(store.profiles[0].data.settings.callsign).toBe("N0CALL");
            expect(store.profiles[0].data.settings.locator).toBe("FN20");
            expect(store.profiles[0].data.settings.default_radius).toBe(12000);
            expect(store.profiles[0].data.settings.is_miles).toBe(true);
        });
        expect(map_controls.location.displayed_locator).toBe("FN20");
        expect(set_radius_in_km).toHaveBeenCalledWith("12000");
    });

    it("applies layout from one direct workspace option", async () => {
        const user = userEvent.setup();
        const { container } = render_settings_modal();

        await user.click(container.querySelector(".cursor-pointer"));
        await user.click(screen.getByText("Layout"));

        expect(screen.getByText("Map only")).not.toBeNull();
        expect(screen.getByText("Table only")).not.toBeNull();
        expect(screen.getByText("Map + Table")).not.toBeNull();
        expect(screen.getByText("Table + Map")).not.toBeNull();
        expect(screen.queryByText("Panel Order")).toBeNull();

        await user.click(screen.getByText("Table + Map"));
        await user.click(screen.getByText("Apply"));

        await waitFor(() => {
            const store = JSON.parse(window.localStorage.getItem(PROFILE_STORE_KEY));
            expect(store.profiles[0].data.settings.main_view_mode).toBe("both");
            expect(store.profiles[0].data.settings.main_view_order).toBe("table_map");
        });
    });

    it("keeps the first-launch settings modal open", async () => {
        render_settings_modal();

        expect(await screen.findByText("Apply")).not.toBeNull();
    });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";

import { FiltersProvider, useFilters } from "@/hooks/useFilters.jsx";
import { ProfilesProvider, useProfiles } from "@/hooks/useProfiles.jsx";
import {
    create_default_profile_data,
    PROFILE_STORE_KEY,
    PROFILE_STORE_VERSION,
} from "@/utils/profile_data.js";
import { encode_filter_state } from "@/utils/filter_url_state.js";

function create_profile_data(overrides = {}) {
    const defaults = create_default_profile_data();

    return {
        ...defaults,
        ...overrides,
        settings: {
            ...defaults.settings,
            ...overrides.settings,
        },
        filters: {
            ...defaults.filters,
            ...overrides.filters,
        },
    };
}

function write_profile_store({ active_profile_name = "Default", profiles }) {
    window.localStorage.setItem(
        PROFILE_STORE_KEY,
        JSON.stringify({
            version: PROFILE_STORE_VERSION,
            active_profile_name,
            profiles,
        }),
    );
}

function render_with_router(children, initial_entry = "/") {
    return render(<MemoryRouter initialEntries={[initial_entry]}>{children}</MemoryRouter>);
}

function ProfileIsolationHarness() {
    const {
        active_profile_name,
        active_profile_data,
        create_profile,
        set_active_profile_name,
        update_active_profile_section,
    } = useProfiles();

    function set_callsign(callsign) {
        update_active_profile_section("settings", settings => ({
            ...settings,
            callsign,
        }));
    }

    return (
        <div>
            <div data-testid="active-name">{active_profile_name}</div>
            <div data-testid="callsign">{active_profile_data.settings.callsign}</div>
            <button
                type="button"
                onClick={() =>
                    create_profile("Portable", {
                        ...active_profile_data,
                        settings: {
                            ...active_profile_data.settings,
                            callsign: "PORTABLE",
                        },
                    })
                }
            >
                Create Portable
            </button>
            <button type="button" onClick={() => set_callsign("PORTABLE-CALL")}>
                Set Portable Callsign
            </button>
            <button type="button" onClick={() => set_active_profile_name("Default")}>
                Switch Default
            </button>
            <button type="button" onClick={() => set_callsign("DEFAULT-CALL")}>
                Set Default Callsign
            </button>
            <button type="button" onClick={() => set_active_profile_name("Portable")}>
                Switch Portable
            </button>
        </div>
    );
}

function UrlCleanupHarness() {
    const { active_profile_name, rename_profile, set_active_profile_name } = useProfiles();
    const location = useLocation();

    return (
        <div>
            <div data-testid="active-name">{active_profile_name}</div>
            <div data-testid="search">{location.search}</div>
            <div data-testid="hash">{location.hash}</div>
            <button type="button" onClick={() => rename_profile(active_profile_name, "Renamed")}>
                Rename Active
            </button>
            <button type="button" onClick={() => set_active_profile_name("Second")}>
                Switch Second
            </button>
        </div>
    );
}

function SharedFiltersHarness() {
    const { filters, setFilters, setProfileFilters, save_shared_filters, is_shared_filter_state } =
        useFilters();
    const {
        active_profile_data: { filters: profile_filters },
    } = useProfiles();
    const location = useLocation();

    return (
        <div>
            <div data-testid="visible-time-limit">{filters.time_limit}</div>
            <div data-testid="profile-time-limit">{profile_filters.time_limit}</div>
            <div data-testid="shared-state">{is_shared_filter_state ? "yes" : "no"}</div>
            <div data-testid="search">{location.search}</div>
            <button
                type="button"
                onClick={() =>
                    setFilters(current_filters => ({
                        ...current_filters,
                        time_limit: 1800,
                    }))
                }
            >
                Update Visible Filters
            </button>
            <button
                type="button"
                onClick={() =>
                    setProfileFilters(current_filters => ({
                        ...current_filters,
                        time_limit: 7200,
                    }))
                }
            >
                Update Profile Filters
            </button>
            <button type="button" onClick={save_shared_filters}>
                Save Shared Filters
            </button>
        </div>
    );
}

describe("profile provider integration", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        window.localStorage.clear();
    });

    it("keeps profile updates isolated when creating and switching profiles", async () => {
        const user = userEvent.setup();

        render_with_router(
            <ProfilesProvider>
                <ProfileIsolationHarness />
            </ProfilesProvider>,
        );

        expect(screen.getByTestId("active-name").textContent).toBe("Default");
        expect(screen.getByTestId("callsign").textContent).toBe("");

        await user.click(screen.getByText("Create Portable"));
        await waitFor(() => expect(screen.getByTestId("active-name").textContent).toBe("Portable"));
        expect(screen.getByTestId("callsign").textContent).toBe("PORTABLE");

        await user.click(screen.getByText("Set Portable Callsign"));
        await waitFor(() =>
            expect(screen.getByTestId("callsign").textContent).toBe("PORTABLE-CALL"),
        );

        await user.click(screen.getByText("Switch Default"));
        await waitFor(() => expect(screen.getByTestId("active-name").textContent).toBe("Default"));
        expect(screen.getByTestId("callsign").textContent).toBe("");

        await user.click(screen.getByText("Set Default Callsign"));
        await waitFor(() =>
            expect(screen.getByTestId("callsign").textContent).toBe("DEFAULT-CALL"),
        );

        await user.click(screen.getByText("Switch Portable"));
        await waitFor(() => expect(screen.getByTestId("active-name").textContent).toBe("Portable"));
        expect(screen.getByTestId("callsign").textContent).toBe("PORTABLE-CALL");

        const stored_profiles = JSON.parse(window.localStorage.getItem(PROFILE_STORE_KEY));
        expect(stored_profiles.active_profile_name).toBe("Portable");
        expect(
            stored_profiles.profiles.find(profile => profile.name === "Default").data.settings
                .callsign,
        ).toBe("DEFAULT-CALL");
        expect(
            stored_profiles.profiles.find(profile => profile.name === "Portable").data.settings
                .callsign,
        ).toBe("PORTABLE-CALL");
    });

    it("clears shared filter URLs only when the active profile actually switches", async () => {
        const user = userEvent.setup();
        write_profile_store({
            profiles: [
                { name: "Default", data: create_profile_data() },
                { name: "Second", data: create_profile_data() },
            ],
        });

        render_with_router(
            <ProfilesProvider>
                <UrlCleanupHarness />
            </ProfilesProvider>,
            "/?filters=shared&keep=1#spot",
        );

        await user.click(screen.getByText("Rename Active"));
        await waitFor(() => expect(screen.getByTestId("active-name").textContent).toBe("Renamed"));
        expect(screen.getByTestId("search").textContent).toBe("?filters=shared&keep=1");
        expect(screen.getByTestId("hash").textContent).toBe("#spot");

        await user.click(screen.getByText("Switch Second"));
        await waitFor(() => expect(screen.getByTestId("active-name").textContent).toBe("Second"));
        expect(screen.getByTestId("search").textContent).toBe("?keep=1");
        expect(screen.getByTestId("hash").textContent).toBe("#spot");
    });

    it("keeps shared filter URL state temporary until it is saved", async () => {
        const user = userEvent.setup();
        const stored_profile_data = create_profile_data({
            filters: {
                ...create_default_profile_data().filters,
                time_limit: 3600,
            },
        });
        const shared_filters = {
            ...stored_profile_data.filters,
            time_limit: 900,
        };
        const shared_filter_param = encode_filter_state(
            shared_filters,
            stored_profile_data.callsign_filters,
        );

        write_profile_store({
            profiles: [{ name: "Default", data: stored_profile_data }],
        });

        render_with_router(
            <ProfilesProvider>
                <FiltersProvider>
                    <SharedFiltersHarness />
                </FiltersProvider>
            </ProfilesProvider>,
            `/?filters=${shared_filter_param}&keep=1#spot`,
        );

        expect(screen.getByTestId("shared-state").textContent).toBe("yes");
        expect(screen.getByTestId("visible-time-limit").textContent).toBe("900");
        expect(screen.getByTestId("profile-time-limit").textContent).toBe("3600");

        await user.click(screen.getByText("Update Visible Filters"));
        await waitFor(() =>
            expect(screen.getByTestId("visible-time-limit").textContent).toBe("1800"),
        );
        expect(screen.getByTestId("profile-time-limit").textContent).toBe("3600");

        await user.click(screen.getByText("Update Profile Filters"));
        await waitFor(() =>
            expect(screen.getByTestId("profile-time-limit").textContent).toBe("7200"),
        );
        expect(screen.getByTestId("visible-time-limit").textContent).toBe("1800");

        await user.click(screen.getByText("Save Shared Filters"));
        await waitFor(() => expect(screen.getByTestId("shared-state").textContent).toBe("no"));
        expect(screen.getByTestId("visible-time-limit").textContent).toBe("1800");
        expect(screen.getByTestId("profile-time-limit").textContent).toBe("1800");
        expect(screen.getByTestId("search").textContent).toBe("?keep=1");
    });
});

import { describe, expect, it } from "vitest";

import { HUNTER_SECTION_KEYS } from "@/data/hunter_sections.js";
import {
    DEFAULT_PROFILE_NAME,
    PROFILE_SECTION_KEYS,
    PROFILE_STORE_VERSION,
    create_default_profile_data,
    create_profile_export,
    pick_profile_sections,
    read_legacy_profile_data,
    sanitize_imported_profile,
    sanitize_profile_data,
    sanitize_profile_store,
} from "@/utils/profile_data.js";

function json(value) {
    return JSON.stringify(value);
}

function create_storage(values) {
    return {
        getItem(key) {
            return Object.hasOwn(values, key) ? values[key] : null;
        },
    };
}

function create_default_hunter_worked() {
    return Object.fromEntries(HUNTER_SECTION_KEYS.map(section => [section, { global: [] }]));
}

describe("profile_data", () => {
    it("creates a default profile store when no store exists", () => {
        const store = sanitize_profile_store(null);

        expect(store.version).toBe(PROFILE_STORE_VERSION);
        expect(store.active_profile_name).toBe(DEFAULT_PROFILE_NAME);
        expect(store.profiles).toHaveLength(1);
        expect(store.profiles[0].name).toBe(DEFAULT_PROFILE_NAME);
        expect(store.profiles[0].data.settings.theme).toBe("Dark");
        expect(store.profiles[0].data.settings.main_view_mode).toBe("both");
        expect(store.profiles[0].data.settings.main_view_order).toBe("map_table");
        expect(store.profiles[0].data.settings).not.toHaveProperty("show_equator");
        expect(store.profiles[0].data.hunter).toEqual({
            worked: create_default_hunter_worked(),
            imports: [],
        });
        expect(store.profiles[0].data.map_controls.show_maidenhead_grid).toBe(false);
        expect(store.profiles[0].data.map_controls.show_equator).toBe(false);
        expect(store.profiles[0].data.map_view.radius_in_km).toBe(20000);
    });

    it("keeps profile names unique and falls back to a valid active profile", () => {
        const store = sanitize_profile_store({
            active_profile_name: "Missing",
            profiles: [
                { name: "Portable", data: {} },
                { name: "Portable", data: {} },
                { name: "", data: {} },
            ],
        });

        expect(store.active_profile_name).toBe("Portable");
        expect(store.profiles.map(profile => profile.name)).toEqual([
            "Portable",
            "Portable (2)",
            "Profile 3",
        ]);
    });

    it("sanitizes invalid profile section values", () => {
        const defaults = create_default_profile_data();
        const data = sanitize_profile_data({
            settings: {
                locator: "???",
                default_radius: 1234,
                theme: "  Solar  ",
                callsign: " n0call ",
                main_view_mode: "unknown",
                main_view_order: "unknown",
                highlight_port: 80,
                disabled_bands: { 20: "yes", 40: true },
                disabled_modes: { FT8: true },
            },
            map_controls: {
                night: "yes",
                show_maidenhead_grid: "yes",
                show_equator: "yes",
                location: {
                    displayed_locator: "???",
                    location: [999, 10],
                },
            },
            map_view: {
                auto_radius: "true",
                radius_in_km: 999999,
            },
            table_sort: {
                column: "unknown",
                ascending: "yes",
            },
            history: {
                window_size_ms: 999,
                display_hours: 13,
                time_between_shifts: 1000,
            },
            panels: {
                heatmap_continent: "ZZ",
                frequency_bar_band: "nope",
                dxpeditions_sort: "unknown",
                dxpeditions_filter: "unknown",
            },
            radio: {
                requested_rig: 3,
            },
            hunter: {
                worked: {
                    dxcc: {
                        global: [
                            " United States ",
                            "",
                            null,
                            "Fed. Rep. of Germany",
                            "United States",
                        ],
                    },
                    cq_zone: { global: [1, "40", 41, "bad", 1] },
                    itu_zone: { global: [0, 1, "90", 91] },
                    us_state: { global: ["ca", "ZZ", "DC"] },
                    ca_province: { global: ["on", "XX", "NU"] },
                    unknown: { global: ["x"] },
                },
                imports: [
                    {
                        file_name: " log.adi ",
                        imported_at: 123,
                        qso_count: "4",
                        added_counts: {
                            dxcc: "2",
                            cq_zone: -1,
                            ca_province: 1,
                        },
                        skipped_count: "bad",
                        resolved_count: 3,
                        unresolved_count: -1,
                        conflict_count: 1,
                    },
                    null,
                ],
            },
        });

        expect(data.settings.locator).toBe(defaults.settings.locator);
        expect(data.settings.default_radius).toBe(defaults.settings.default_radius);
        expect(data.settings.theme).toBe("Solar");
        expect(data.settings.callsign).toBe("N0CALL");
        expect(data.settings.main_view_mode).toBe(defaults.settings.main_view_mode);
        expect(data.settings.main_view_order).toBe(defaults.settings.main_view_order);
        expect(data.settings.highlight_port).toBe(defaults.settings.highlight_port);
        expect(data.settings.disabled_bands[20]).toBe(defaults.settings.disabled_bands[20]);
        expect(data.settings.disabled_bands[40]).toBe(true);
        expect(data.settings.disabled_modes.FT8).toBe(true);
        expect(data.map_controls.night).toBe(defaults.map_controls.night);
        expect(data.map_controls.show_maidenhead_grid).toBe(
            defaults.map_controls.show_maidenhead_grid,
        );
        expect(data.map_controls.show_equator).toBe(defaults.map_controls.show_equator);
        expect(data.map_controls.location).toEqual(defaults.map_controls.location);
        expect(data.map_view).toEqual(defaults.map_view);
        expect(data.table_sort).toEqual(defaults.table_sort);
        expect(data.history).toEqual(defaults.history);
        expect(data.panels).toEqual(defaults.panels);
        expect(data.radio).toEqual(defaults.radio);
        expect(data.hunter).toEqual({
            worked: {
                dxcc: { global: [291, 230] },
                cq_zone: { global: [1, 40] },
                itu_zone: { global: [1, 90] },
                us_state: { global: ["CA", "DC"] },
                ca_province: { global: ["ON", "NU"] },
            },
            imports: [
                {
                    file_name: "log.adi",
                    imported_at: 123,
                    qso_count: 4,
                    added_counts: {
                        dxcc: 2,
                        cq_zone: 0,
                        itu_zone: 0,
                        us_state: 0,
                        ca_province: 1,
                    },
                    skipped_count: 0,
                    resolved_count: 3,
                    unresolved_count: 0,
                    conflict_count: 1,
                },
            ],
        });
    });

    it("migrates legacy local-storage values into profile data", () => {
        const storage = create_storage({
            settings: json({
                locator: "FN20",
                default_radius: 12000,
                callsign: "n0call",
                disabled_bands: { 20: true },
                disabled_modes: { FT8: true },
            }),
            filters: json({
                bands: { 20: false },
                modes: { CW: false },
                time_limit: 900,
            }),
            callsign_filters: json({
                is_alert_filters_active: false,
                filters: [
                    {
                        action: "alert",
                        type: "prefix",
                        spotter_or_dx: "dx",
                        value: "VK",
                    },
                ],
            }),
            map_controls: json({
                night: true,
                is_globe: true,
                show_maidenhead_grid: true,
                show_equator: true,
                location: {
                    displayed_locator: "FN20",
                    location: [-75, 40],
                },
            }),
            table_sort: json({ column: "freq", ascending: true }),
            auto_radius: json(false),
            currnet_theme: json("Aurora"),
            "history-window-size": json(3600000),
            "history-display-hours": json(48),
            "history-time-between-shifts": json(10),
            heatmap_continent: json("NA"),
            freq_bar_selected_freq: json(-1),
            dxpeditions_sort: json("start"),
            dxpeditions_filter: json("active"),
            requested_rig: json(2),
        });

        const data = read_legacy_profile_data(storage);

        expect(data.settings.locator).toBe("FN20");
        expect(data.settings.default_radius).toBe(12000);
        expect(data.settings.theme).toBe("Aurora");
        expect(data.settings.callsign).toBe("N0CALL");
        expect(data.settings.disabled_bands[20]).toBe(true);
        expect(data.settings.disabled_modes.FT8).toBe(true);
        expect(data.filters.bands[20]).toBe(false);
        expect(data.filters.modes.CW).toBe(false);
        expect(data.filters.time_limit).toBe(900);
        expect(data.callsign_filters.is_alert_filters_active).toBe(false);
        expect(data.callsign_filters.filters).toEqual([
            {
                action: "alert",
                type: "prefix",
                value: "VK",
                spotter_or_dx: "dx",
            },
        ]);
        expect(data.map_controls.night).toBe(true);
        expect(data.map_controls.is_globe).toBe(true);
        expect(data.map_controls.show_maidenhead_grid).toBe(true);
        expect(data.map_controls.show_equator).toBe(true);
        expect(data.map_controls.location).toEqual({
            displayed_locator: "FN20",
            location: [-75, 40],
        });
        expect(data.map_view).toEqual({ auto_radius: false, radius_in_km: 12000 });
        expect(data.table_sort).toEqual({ column: "freq", ascending: true });
        expect(data.history).toEqual({
            window_size_ms: 3600000,
            step_size_ms: 900000,
            display_hours: 48,
            time_between_shifts: 10,
        });
        expect(data.panels).toEqual({
            heatmap_continent: "NA",
            frequency_bar_band: -1,
            dxpeditions_sort: "start",
            dxpeditions_filter: "active",
        });
        expect(data.radio.requested_rig).toBe(2);
    });

    it("exports selected profile sections and imports omitted sections from defaults", () => {
        const defaults = create_default_profile_data();
        const profile = {
            name: "Portable",
            data: {
                ...defaults,
                settings: {
                    ...defaults.settings,
                    callsign: "N0CALL",
                },
                filters: {
                    ...defaults.filters,
                    time_limit: 900,
                },
                panels: {
                    ...defaults.panels,
                    frequency_bar_band: -1,
                },
                hunter: {
                    ...defaults.hunter,
                    worked: {
                        ...defaults.hunter.worked,
                        dxcc: { global: [291] },
                    },
                },
            },
        };

        const exported = create_profile_export(profile, ["settings", "filters", "hunter"]);
        const imported = sanitize_imported_profile(exported);

        expect(PROFILE_SECTION_KEYS).toContain("hunter");
        expect(exported).toEqual({
            version: PROFILE_STORE_VERSION,
            name: "Portable",
            data: {
                settings: profile.data.settings,
                filters: profile.data.filters,
                hunter: profile.data.hunter,
            },
        });
        expect(imported.name).toBe("Portable");
        expect(imported.data.settings.callsign).toBe("N0CALL");
        expect(imported.data.filters.time_limit).toBe(900);
        expect(imported.data.hunter.worked.dxcc.global).toEqual([291]);
        expect(imported.data.panels.frequency_bar_band).toBe(defaults.panels.frequency_bar_band);
    });

    it("adds default hunter data to old profiles without hunter", () => {
        const defaults = create_default_profile_data();
        const imported = sanitize_imported_profile({
            name: "Old Profile",
            data: {
                settings: { callsign: "old" },
            },
        });

        expect(imported.name).toBe("Old Profile");
        expect(imported.data.settings.callsign).toBe("OLD");
        expect(imported.data.hunter).toEqual(defaults.hunter);
    });

    it("imports the active profile from a profile store export", () => {
        const defaults = create_default_profile_data();
        const imported = sanitize_imported_profile({
            active_profile_name: "Second",
            profiles: [
                {
                    name: "First",
                    data: {
                        ...defaults,
                        settings: { ...defaults.settings, callsign: "FIRST" },
                    },
                },
                {
                    name: "Second",
                    data: {
                        ...defaults,
                        settings: { ...defaults.settings, callsign: "SECOND" },
                    },
                },
            ],
        });

        expect(imported.name).toBe("Second");
        expect(imported.data.settings.callsign).toBe("SECOND");
    });

    it("ignores unknown section keys when picking profile sections", () => {
        const data = create_default_profile_data();

        expect(pick_profile_sections(data, ["filters", "unknown"])).toEqual({
            filters: data.filters,
        });
    });
});

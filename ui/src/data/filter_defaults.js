import { bands, continents, modes } from "@/data/filters_data.js";

export function create_initial_filters() {
    return {
        bands: Object.fromEntries(Array.from(bands).map(band => [band, true])),
        modes: Object.fromEntries(modes.map(mode => [mode, true])),
        radio_band: false,
        dx_continents: Object.fromEntries(continents.map(continent => [continent, true])),
        spotter_continents: Object.fromEntries(continents.map(continent => [continent, true])),
        time_limit: 3600,
        show_only_latest_spot: false,
        zone_filters: {
            disabled_by_system: {
                cq: [],
                itu: [],
                us_state: [],
                ca_province: [],
            },
        },
    };
}

export function create_initial_callsign_filters() {
    return {
        is_alert_filters_active: true,
        is_show_only_filters_active: true,
        is_hide_filters_active: true,
        filters: [],
    };
}

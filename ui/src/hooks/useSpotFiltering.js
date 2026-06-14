import { bands, modes } from "@/data/filters_data.js";
import { get_flag } from "@/data/flags.js";
import { useProfiles } from "@/hooks/useProfiles.jsx";
import { is_matching_list, sort_spots } from "@/utils.js";
import { HUNTER_SECTION_KEYS } from "@/utils/profile_data.js";
import { normalize_zone_value } from "@/utils/zones.js";
import { useMemo, useState } from "react";
import { useFilters } from "./useFilters";
import use_radio from "./useRadio";
import { useSpotInteraction } from "./useSpotInteraction";

const reference_spot_types = new Set(["sota", "pota", "wwff"]);

const US_STATE_COUNTRIES = new Set(["USA", "Alaska", "Hawaii"]);

const SECTION_REASON_LABELS = {
    dxcc: value => `Needed DXCC: ${value}`,
    cq_zone: value => `Needed CQ Zone: ${value}`,
    itu_zone: value => `Needed ITU Zone: ${value}`,
    us_state: value => `Needed US State: ${value}`,
    ca_province: value => `Needed CA Province: ${value}`,
};

function get_spot_feature_value(section, spot) {
    switch (section) {
        case "dxcc":
            return spot.dx_country || null;
        case "cq_zone":
            return normalize_zone_value("cq", spot.dx_cq_zone);
        case "itu_zone":
            return normalize_zone_value("itu", spot.dx_itu_zone);
        case "us_state":
            if (!US_STATE_COUNTRIES.has(spot.dx_country)) return null;
            return normalize_zone_value("us_state", spot.dx_state);
        case "ca_province":
            if (spot.dx_country !== "Canada") return null;
            return normalize_zone_value("ca_province", spot.dx_state);
        default:
            return null;
    }
}

export function check_hunter_needed(spot, hunter) {
    if (!hunter?.enabled_sections) return null;

    const reasons = [];
    for (const section of HUNTER_SECTION_KEYS) {
        if (!hunter.enabled_sections[section]) continue;

        const spot_value = get_spot_feature_value(section, spot);
        if (spot_value == null) continue;

        const worked = hunter.worked[section]?.global ?? [];
        if (!worked.includes(spot_value)) {
            reasons.push({
                section,
                value: spot_value,
                label: SECTION_REASON_LABELS[section](spot_value),
            });
        }
    }

    if (reasons.length === 0) return null;

    return { is_needed: true, reasons };
}

const freq_error_range = {
    FT8: 0.2,
    FT4: 0.2,
    DIGI: 0.2,
    CW: 0.2,
    SSB: 0.5,
};

function limit_count(count) {
    return Math.min(count, 99);
}

export default function useSpotFiltering(raw_spots, is_history_mode = false) {
    const { filters, callsign_filters } = useFilters();
    const {
        active_profile_data: { table_sort, hunter },
    } = useProfiles();
    const { radio_band, radio_freq, radio_status } = use_radio();
    const { search_query, selected_reference_type } = useSpotInteraction();

    const [filter_missing_flags, set_filter_missing_flags] = useState(false);

    const show_only_filters = useMemo(
        () => callsign_filters.filters.filter(filter => filter.action === "show_only"),
        [callsign_filters.filters],
    );
    const hide_filters = useMemo(
        () => callsign_filters.filters.filter(filter => filter.action === "hide"),
        [callsign_filters.filters],
    );
    const alerts = useMemo(
        () => callsign_filters.filters.filter(filter => filter.action === "alert"),
        [callsign_filters.filters],
    );

    const source_spots = useMemo(() => {
        if (selected_reference_type) {
            return raw_spots.filter(spot => spot.type === selected_reference_type);
        }
        return raw_spots.filter(spot => !reference_spot_types.has(spot.type));
    }, [raw_spots, selected_reference_type]);

    const spots_with_alerts = useMemo(() => {
        return source_spots.map(spot => {
            const hunter_needed_result = check_hunter_needed(spot, hunter);
            const is_alert_filter_match =
                is_matching_list(alerts, spot) && callsign_filters.is_alert_filters_active;
            return {
                ...spot,
                is_alerted: is_alert_filter_match || Boolean(hunter_needed_result?.is_needed),
                hunterNeeded: hunter_needed_result,
            };
        });
    }, [source_spots, alerts, callsign_filters.is_alert_filters_active, hunter]);

    const spots = useMemo(() => {
        const current_time = new Date().getTime() / 1000;
        let filtered = spots_with_alerts
            .filter(spot => {
                if (filter_missing_flags) {
                    if (
                        spot.dx_country !== "" &&
                        spot.dx_country != null &&
                        get_flag(spot.dx_country) == null
                    ) {
                        return true;
                    }
                    return false;
                }

                const is_in_time_limit =
                    is_history_mode || current_time - spot.time < filters.time_limit;

                const normalized_search = search_query.toLowerCase();
                const is_matching_search = [
                    spot.dx_callsign,
                    spot.spotter_callsign,
                    spot.pota_reference,
                ].some(value => (value ?? "").toLowerCase().startsWith(normalized_search));
                const is_matching_pota_text = [spot.pota_name, spot.pota_description].some(value =>
                    (value ?? "").toLowerCase().includes(normalized_search),
                );

                // If the search is not empty, it override everything else
                if (search_query.length > 0) {
                    return (is_matching_search || is_matching_pota_text) && is_in_time_limit;
                }

                // Alerted spots are always displayed
                if (spot.is_alerted && is_in_time_limit) {
                    return true;
                }

                const is_band_and_mode_active =
                    ((filters.radio_band && radio_band === spot.band) ||
                        (!filters.radio_band && filters.bands[spot.band])) &&
                    filters.modes[spot.mode];

                const are_include_filters_empty = show_only_filters.length === 0;
                const are_exclude_filters_empty = hide_filters.length === 0;
                const are_filters_including =
                    is_matching_list(show_only_filters, spot) ||
                    are_include_filters_empty ||
                    !callsign_filters.is_show_only_filters_active;
                const are_filters_not_excluding =
                    !is_matching_list(hide_filters, spot) ||
                    are_exclude_filters_empty ||
                    !callsign_filters.is_hide_filters_active;

                const is_dx_continent_active = filters.dx_continents[spot.dx_continent];
                const is_spotter_continent_active =
                    filters.spotter_continents[spot.spotter_continent];

                const result =
                    is_in_time_limit &&
                    is_dx_continent_active &&
                    is_spotter_continent_active &&
                    is_band_and_mode_active &&
                    are_filters_including &&
                    are_filters_not_excluding;
                return result;
            })
            .slice(0, 100);

        if (filters.show_only_latest_spot) {
            const latest_spots = new Map();
            for (const spot of filtered) {
                const existing = latest_spots.get(spot.dx_callsign);
                if (!existing || spot.time > existing.time) {
                    latest_spots.set(spot.dx_callsign, spot);
                }
            }
            filtered = Array.from(latest_spots.values());
        }

        // Sort the filtered spots
        return sort_spots(filtered, table_sort, radio_status, radio_band);
    }, [
        spots_with_alerts,
        filter_missing_flags,
        filters,
        show_only_filters,
        hide_filters,
        callsign_filters.is_show_only_filters_active,
        callsign_filters.is_hide_filters_active,
        radio_band,
        radio_status,
        table_sort,
        filters.show_only_latest_spot,
        search_query,
        is_history_mode,
    ]);

    const spots_per_band_count = useMemo(() => {
        return Object.fromEntries(
            bands.map(band => [band, limit_count(spots.filter(spot => spot.band === band).length)]),
        );
    }, [spots]);

    const spots_per_mode_count = useMemo(() => {
        return Object.fromEntries(
            modes.map(mode => [mode, limit_count(spots.filter(spot => spot.mode === mode).length)]),
        );
    }, [spots]);

    const current_freq_spots = useMemo(() => {
        return spots
            .filter(spot => {
                return (
                    radio_freq / 1000 >= spot.freq - freq_error_range[spot.mode] &&
                    radio_freq / 1000 <= spot.freq + freq_error_range[spot.mode]
                );
            })
            .map(spot => spot.id);
    }, [spots, radio_freq]);

    return {
        spots,
        spots_with_alerts,
        filter_missing_flags,
        set_filter_missing_flags,
        spots_per_band_count,
        spots_per_mode_count,
        current_freq_spots,
    };
}

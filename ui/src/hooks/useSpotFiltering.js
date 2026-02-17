import { useMemo, useState } from "react";
import { useFilters } from "./useFilters";
import { useSettings } from "./useSettings";
import use_radio from "./useRadio";
import { useSpotInteraction } from "./useSpotInteraction";
import { is_matching_list, sort_spots, use_object_local_storage } from "@/utils.js";
import { bands, modes } from "@/filters_data.js";
import { get_flag } from "@/flags.js";

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

export default function useSpotFiltering(raw_spots) {
    const { filters, callsign_filters } = useFilters();
    const { settings } = useSettings();
    const { radio_band, radio_freq, radio_status } = use_radio();
    const { search_query } = useSpotInteraction();

    const [filter_missing_flags, set_filter_missing_flags] = useState(false);

    const [table_sort] = use_object_local_storage("table_sort", {
        column: "time",
        ascending: false,
    });

    const show_only_filters = useMemo(
        () => callsign_filters.filters.filter(filter => filter.action == "show_only"),
        [callsign_filters.filters],
    );
    const hide_filters = useMemo(
        () => callsign_filters.filters.filter(filter => filter.action == "hide"),
        [callsign_filters.filters],
    );
    const alerts = useMemo(
        () => callsign_filters.filters.filter(filter => filter.action == "alert"),
        [callsign_filters.filters],
    );

    const spots_with_alerts = useMemo(() => {
        return raw_spots.map(spot => ({
            ...spot,
            is_alerted: is_matching_list(alerts, spot) && callsign_filters.is_alert_filters_active,
        }));
    }, [raw_spots, alerts, callsign_filters.is_alert_filters_active]);

    const spots = useMemo(() => {
        const current_time = new Date().getTime() / 1000;
        let filtered = spots_with_alerts
            .filter(spot => {
                if (filter_missing_flags) {
                    if (
                        spot.dx_country != "" &&
                        spot.dx_country != null &&
                        get_flag(spot.dx_country) == null
                    ) {
                        return true;
                    } else {
                        return false;
                    }
                }

                const is_in_time_limit = current_time - spot.time < filters.time_limit;

                const is_matching_search = spot.dx_callsign
                    .toLowerCase()
                    .startsWith(search_query.toLowerCase());

                // If the search is not empty, it override everything else
                if (search_query.length > 0) {
                    return is_matching_search && is_in_time_limit;
                }

                // Alerted spots are always displayed
                if (spot.is_alerted && is_in_time_limit) {
                    return true;
                }

                const is_band_and_mode_active =
                    ((filters.radio_band && radio_band == spot.band) ||
                        (!filters.radio_band && filters.bands[spot.band])) &&
                    filters.modes[spot.mode];

                const are_include_filters_empty = show_only_filters.length == 0;
                const are_exclude_filters_empty = hide_filters.length == 0;
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

        if (settings.show_only_latest_spot) {
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
        settings.show_only_latest_spot,
        search_query,
    ]);

    const spots_per_band_count = useMemo(() => {
        return Object.fromEntries(
            bands.map(band => [band, limit_count(spots.filter(spot => spot.band == band).length)]),
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

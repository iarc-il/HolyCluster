import { play_alert_sound } from "@/utils.js";
import { createContext, useContext, useEffect } from "react";
import { useFilters } from "./useFilters";
import useHistorySpots from "./useHistorySpots";
import use_radio from "./useRadio";
import { useSettings } from "./useSettings";
import useSpotFiltering from "./useSpotFiltering";
import { useSpotInteraction } from "./useSpotInteraction";
import useSpotWebSocket from "./useSpotWebSocket";

const SpotDataContext = createContext(undefined);

export function useSpotData() {
    return useContext(SpotDataContext);
}

export const SpotDataProvider = ({ children, startTime, endTime, window_size_ms }) => {
    const {
        raw_spots: ws_raw_spots,
        new_spot_ids: ws_new_spot_ids,
        network_state,
    } = useSpotWebSocket();
    const { raw_spots: history_raw_spots, fetch_state } = useHistorySpots(
        startTime,
        endTime,
        window_size_ms,
    );

    const is_history_mode = !!(startTime && endTime);
    const raw_spots = is_history_mode ? history_raw_spots : ws_raw_spots;
    const new_spot_ids = is_history_mode ? new Set() : ws_new_spot_ids;
    const {
        spots,
        spots_with_alerts,
        filter_missing_flags,
        set_filter_missing_flags,
        spots_per_band_count,
        spots_per_mode_count,
        current_freq_spots,
    } = useSpotFiltering(raw_spots, is_history_mode);

    const { pinned_spot } = useSpotInteraction();
    const { settings } = useSettings();
    const { callsign_filters } = useFilters();
    const { highlight_spot, is_radio_available } = use_radio();

    // Play alert sound when new alerted spots arrive
    useEffect(() => {
        if (
            !is_history_mode &&
            new_spot_ids.size > 0 &&
            settings.alert_sound_enabled &&
            callsign_filters.is_alert_filters_active
        ) {
            const alerted_count = spots_with_alerts.filter(
                spot => new_spot_ids.has(spot.id) && spot.is_alerted,
            ).length;

            if (alerted_count > 0) {
                play_alert_sound();
            }
        }
    }, [
        new_spot_ids,
        spots_with_alerts,
        settings.alert_sound_enabled,
        callsign_filters.is_alert_filters_active,
    ]);

    // Highlight spot on radio when pinned
    useEffect(() => {
        if (pinned_spot && settings.highlight_enabled && is_radio_available()) {
            highlight_spot(
                raw_spots.find(spot => spot.id === pinned_spot),
                settings.highlight_port,
            );
        }
    }, [pinned_spot]);

    return (
        <SpotDataContext.Provider
            value={{
                spots,
                raw_spots,
                new_spot_ids,
                filter_missing_flags,
                set_filter_missing_flags,
                spots_per_band_count,
                spots_per_mode_count,
                network_state,
                current_freq_spots,
                is_history_mode,
                fetch_state,
            }}
        >
            {children}
        </SpotDataContext.Provider>
    );
};

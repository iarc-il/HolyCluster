import { createContext, useContext, useEffect } from "react";
import useSpotWebSocket from "./useSpotWebSocket";
import useSpotFiltering from "./useSpotFiltering";
import { useSpotInteraction } from "./useSpotInteraction";
import { useFilters } from "./useFilters";
import { useSettings } from "./useSettings";
import use_radio from "./useRadio";
import { play_alert_sound } from "@/utils.js";

const SpotDataContext = createContext(undefined);

export function useSpotData() {
    return useContext(SpotDataContext);
}

export const SpotDataProvider = ({ children }) => {
    const { raw_spots, new_spot_ids, network_state } = useSpotWebSocket();
    const {
        spots,
        spots_with_alerts,
        filter_missing_flags,
        set_filter_missing_flags,
        spots_per_band_count,
        spots_per_mode_count,
        current_freq_spots,
    } = useSpotFiltering(raw_spots);

    const { pinned_spot } = useSpotInteraction();
    const { settings } = useSettings();
    const { callsign_filters } = useFilters();
    const { highlight_spot, is_radio_available } = use_radio();

    // Play alert sound when new alerted spots arrive
    useEffect(() => {
        if (
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
                raw_spots.find(spot => spot.id == pinned_spot),
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
            }}
        >
            {children}
        </SpotDataContext.Provider>
    );
};

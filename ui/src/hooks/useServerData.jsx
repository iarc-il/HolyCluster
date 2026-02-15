import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
import { useFilters } from "../hooks/useFilters";
import { is_matching_list, play_alert_sound, sort_spots } from "@/utils.js";
import { bands, modes, continents } from "@/filters_data.js";
import { get_flag, shorten_dxcc } from "@/flags.js";
import use_radio from "./useRadio";
import { useSettings } from "./useSettings";
import { use_object_local_storage } from "@/utils.js";

const ServerDataContext = createContext(undefined);

export function useServerData() {
    return useContext(ServerDataContext);
}

function normalize_band(band) {
    if (band == 2) return "VHF";
    if (band == 0.7) return "UHF";
    if (band < 1) return "SHF";
    return band;
}

export const ServerDataProvider = ({ children }) => {
    const [raw_spots, set_spots] = useState([]);
    const [new_spot_ids, set_new_spot_ids] = useState(new Set());
    let [hovered_spot, set_hovered_spot] = useState({ source: null, id: null });
    let [hovered_band, set_hovered_band] = useState(null);
    let [pinned_spot, set_pinned_spot_internal] = useState(null);
    let [search_query, set_search_query] = useState("");
    let [search_open, set_search_open] = useState(false);

    const { highlight_spot, is_radio_available } = use_radio();
    const { settings } = useSettings();

    function set_pinned_spot(spot_id) {
        if (spot_id && settings.highlight_enabled && is_radio_available()) {
            highlight_spot(
                raw_spots.find(spot => spot.id == spot_id),
                settings.highlight_port,
            );
        }
        set_pinned_spot_internal(spot_id);
    }

    const [filter_missing_flags, set_filter_missing_flags] = useState(false);

    const { radio_band, radio_freq, radio_status } = use_radio();

    const { filters, callsign_filters } = useFilters();

    const [propagation, set_propagation] = useState();
    const [dxpeditions, set_dxpeditions] = useState([]);

    const [network_state, set_network_state] = useState("connecting");

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

    const [is_first_connection, set_is_first_connection] = useState(true);
    const last_spot_time_ref = useRef(0);
    const next_spot_id_ref = useRef(0);

    const { lastJsonMessage, readyState, sendJsonMessage } = useWebSocket("/spots_ws", {
        onOpen: () => {
            if (is_first_connection) {
                sendJsonMessage({ initial: true });
                set_is_first_connection(false);
            } else {
                sendJsonMessage({ last_time: last_spot_time_ref.current });
            }
        },
        reconnectAttempts: 10,
        reconnectInterval: 5000,
        shouldReconnect: () => navigator.onLine,
    });

    useEffect(() => {
        if (lastJsonMessage) {
            const data = lastJsonMessage;
            let new_spots = data.spots
                .map(spot => {
                    spot.id = next_spot_id_ref.current++;
                    if (spot.mode === "DIGITAL") spot.mode = "DIGI";
                    spot.band = normalize_band(spot.band);
                    spot.dx_country = shorten_dxcc(spot.dx_country);
                    return spot;
                })
                .filter(spot => {
                    if (!modes.includes(spot.mode)) {
                        console.warn(`Dropping spot with unknown mode: ${spot.mode}`, spot);
                        return false;
                    }
                    if (!continents.includes(spot.dx_continent)) {
                        console.warn(
                            `Dropping spot with unknown dx_continent: ${spot.dx_continent}`,
                            spot,
                        );
                        return false;
                    }
                    if (!continents.includes(spot.spotter_continent)) {
                        console.warn(
                            `Dropping spot with unknown spotter_continent: ${spot.spotter_continent}`,
                            spot,
                        );
                        return false;
                    }
                    return true;
                });

            if (data.type === "update") {
                const new_ids = new Set(new_spots.map(spot => spot.id));
                set_new_spot_ids(new_ids);

                setTimeout(() => {
                    set_new_spot_ids(new Set());
                }, 3000);

                new_spots = new_spots.concat(raw_spots);
            }

            let current_time = Math.round(Date.now() / 1000);
            new_spots = new_spots.filter(spot => spot.time > current_time - 3600);
            set_spots(new_spots);

            if (new_spots.length > 0) {
                last_spot_time_ref.current = Math.max(...new_spots.map(spot => spot.time));
            }
        }
    }, [lastJsonMessage]);

    useEffect(() => {
        switch (readyState) {
            case ReadyState.CONNECTING:
                set_network_state("connecting");
                break;
            case ReadyState.OPEN:
                set_network_state("connected");
                break;
            case ReadyState.CLOSED:
                set_network_state("disconnected");
                break;
        }
    }, [readyState]);

    useEffect(() => {
        const fetch_propagation = () => {
            if (!navigator.onLine) return;

            fetch("/propagation")
                .then(response => (response.ok ? response.json() : Promise.reject(response)))
                .then(data => data && set_propagation(data))
                .catch(() => {});
        };

        fetch_propagation();
        const interval_id = setInterval(fetch_propagation, 3600 * 1000);
        return () => clearInterval(interval_id);
    }, []);

    useEffect(() => {
        const fetch_dxpeditions = () => {
            if (!navigator.onLine) return;

            fetch("/dxpeditions")
                .then(response => (response.ok ? response.json() : Promise.reject(response)))
                .then(
                    data => data && set_dxpeditions(data.map((item, id) => ({ id: id, ...item }))),
                )
                .catch(() => {});
        };

        fetch_dxpeditions();
        const interval_id = setInterval(fetch_dxpeditions, 3600 * 1000);
        return () => clearInterval(interval_id);
    }, []);

    const spots_with_alerts = useMemo(() => {
        return raw_spots.map(spot => ({
            ...spot,
            is_alerted: is_matching_list(alerts, spot) && callsign_filters.is_alert_filters_active,
        }));
    }, [raw_spots, alerts, callsign_filters.is_alert_filters_active]);

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

                const is_matching_search =
                    !search_query.trim() ||
                    spot.dx_callsign.toLowerCase().startsWith(search_query.toLowerCase());

                // Alerted spots are displayed, no matter what.
                if ((spot.is_alerted || is_matching_search) && is_in_time_limit) {
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

    function limit_count(count) {
        return Math.min(count, 99);
    }

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

    // Max offset for the frequency error in kHz
    const freq_error_range = {
        FT8: 0.2,
        FT4: 0.2,
        DIGI: 0.2,
        CW: 0.2,
        SSB: 0.5,
    };

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

    return (
        <ServerDataContext.Provider
            value={{
                spots,
                raw_spots,
                new_spot_ids,
                hovered_spot,
                set_hovered_spot,
                hovered_band,
                set_hovered_band,
                pinned_spot,
                set_pinned_spot,
                filter_missing_flags,
                set_filter_missing_flags,
                spots_per_band_count,
                spots_per_mode_count,
                propagation,
                dxpeditions,
                network_state,
                current_freq_spots,
                search_query,
                set_search_query,
                search_open,
                set_search_open,
            }}
        >
            {children}
        </ServerDataContext.Provider>
    );
};

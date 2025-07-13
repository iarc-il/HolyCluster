import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
import { useFilters } from "../hooks/useFilters";
import { get_base_url, is_matching_list, sort_spots } from "@/utils.js";
import { bands } from "@/filters_data.js";
import { get_flag } from "@/flags.js";
import use_radio from "./useRadio";
import { use_object_local_storage } from "@/utils.js";

const ServerDataContext = createContext(undefined);

const { Provider } = ServerDataContext;

export const useServerData = () => {
    const context = useContext(ServerDataContext);
    return { ...context };
};

function fetch_propagation() {
    let url = get_base_url() + "/propagation";

    if (navigator.onLine) {
        return fetch(url, { mode: "cors" })
            .then(response => {
                if (response == null || !response.ok) {
                    return Promise.reject(response);
                } else {
                    return response.json();
                }
            })
            .then(data => {
                if (data == null) {
                    return Promise.reject(response);
                } else {
                    this.set_propagation(data);
                }
            })
            .catch(_ => {});
    }
}

export const ServerDataProvider = ({ children }) => {
    const [spots, set_spots] = useState([]);
    let [hovered_spot, set_hovered_spot] = useState({ source: null, id: null });
    let [hovered_band, set_hovered_band] = useState(null);
    let [pinned_spot, set_pinned_spot] = useState(null);

    const [filter_missing_flags, set_filter_missing_flags] = useState(false);

    const { radio_band, radio_freq, radio_status } = use_radio();

    const { filters, callsign_filters } = useFilters();

    const [propagation, set_propagation] = useState();

    const [network_state, set_network_state] = useState("connecting");

    const [table_sort] = use_object_local_storage("table_sort", {
        column: "time",
        ascending: false,
    });

    let show_only_filters = callsign_filters.filters.filter(filter => filter.action == "show_only");
    let hide_filters = callsign_filters.filters.filter(filter => filter.action == "hide");
    let alerts = callsign_filters.filters.filter(filter => filter.action == "alert");

    const fetch_propagation_context = useRef({
        propagation,
        set_propagation,
    });
    fetch_propagation_context.current.propagation = propagation;

    const spots_context = useRef({
        spots,
        set_spots,
    });
    spots_context.current.spots = structuredClone(spots);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const websocket_url = get_base_url().replace(/^http(s)?:/, protocol) + "/spots_ws";

    const { lastJsonMessage, readyState } = useWebSocket(websocket_url, {
        onOpen: () => set_network_state("connected"),
        onClose: () => set_network_state("disconnected"),
        onError: () => set_network_state("disconnected"),
        reconnectAttempts: 10,
        reconnectInterval: 5000,
        shouldReconnect: () => navigator.onLine,
    });

    useEffect(() => {
        if (lastJsonMessage) {
            const data = lastJsonMessage;
            let new_spots = data.spots.map(spot => {
                if (spot.mode === "DIGITAL") {
                    spot.mode = "DIGI";
                }
                return spot;
            });

            if (data.type === "initial") {
                spots_context.current.set_spots(new_spots);
            } else if (data.type === "update") {
                let spots = new_spots.concat(spots_context.current.spots);
                let current_time = Math.round(Date.now() / 1000);
                spots = spots.filter(spot => spot.time > current_time - 3600);
                spots_context.current.set_spots(spots);
            }
        }
    }, [lastJsonMessage]);

    useEffect(() => {
        if (readyState === ReadyState.CONNECTING) {
            set_network_state("connecting");
        }
    }, [readyState]);

    useEffect(() => {
        const fetch_propagation_with_context = fetch_propagation.bind(
            fetch_propagation_context.current,
        );
        fetch_propagation_with_context();
        let propagation_interval_id = setInterval(fetch_propagation_with_context, 3600 * 1000);

        const handle_online = () => {
            set_network_state("connecting");
            fetch_propagation_with_context();
        };
        const handle_offline = () => {
            set_network_state("disconnected");
        };

        window.addEventListener("online", handle_online);
        window.addEventListener("offline", handle_offline);

        return () => {
            window.removeEventListener("online", handle_online);
            window.removeEventListener("offline", handle_offline);
            clearInterval(propagation_interval_id);
        };
    }, []);

    for (const spot of spots) {
        spot.is_alerted =
            is_matching_list(alerts, spot) && callsign_filters.is_alert_filters_active;
    }

    const filtered_spots = useMemo(() => {
        const current_time = new Date().getTime() / 1000;
        const filtered = spots
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
                // Alerted spots are displayed, no matter what.
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

        // Sort the filtered spots
        return sort_spots(filtered, table_sort, radio_status, radio_band);
    }, [
        spots,
        filter_missing_flags,
        filters,
        callsign_filters,
        radio_band,
        radio_status,
        table_sort,
    ]);

    const spots_per_band_count = useMemo(() => {
        const spots_per_band_count = Object.fromEntries(
            bands.map(band => [band, filtered_spots.filter(spot => spot.band == band).length]),
        );

        // Limit the count for 2 digit display
        for (const band in spots_per_band_count) {
            spots_per_band_count[band] = Math.min(spots_per_band_count[band], 99);
        }
        return spots_per_band_count;
    }, [filtered_spots]);

    // Max offset for the frequency error in kHz
    const freq_error_range = {
        FT8: 0.2,
        FT4: 0.2,
        DIGI: 0.2,
        CW: 0.2,
        SSB: 0.5,
    };
    const current_freq_spots = useMemo(() => {
        return filtered_spots
            .filter(
                spot =>
                    radio_freq / 1000 >= spot.freq - freq_error_range[spot.mode] &&
                    radio_freq / 1000 <= spot.freq + freq_error_range[spot.mode],
            )
            .map(spot => spot.id);
    }, [filtered_spots, radio_freq]);

    return (
        <Provider
            value={{
                spots: filtered_spots,
                hovered_spot,
                set_hovered_spot,
                hovered_band,
                set_hovered_band,
                pinned_spot,
                set_pinned_spot,
                filter_missing_flags,
                set_filter_missing_flags,
                spots_per_band_count,
                propagation,
                network_state,
                current_freq_spots,
            }}
        >
            {children}
        </Provider>
    );
};

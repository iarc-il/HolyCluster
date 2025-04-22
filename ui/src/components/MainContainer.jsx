import SvgMap from "@/components/SvgMap.jsx";
import CanvasMap from "@/components/CanvasMap/index.jsx";
import MapControls from "@/components/MapControls.jsx";
import TopBar from "@/components/TopBar.jsx";
import SpotsTable from "@/components/SpotsTable.jsx";
import Continents from "@/components/Continents.jsx";
import LeftColumn from "@/components/LeftColumn.jsx";
import CallsignsView from "@/components/CallsignsView.jsx";
import Tabs from "@/components/Tabs.jsx";
import { use_object_local_storage, is_matching_list } from "@/utils.js";
import { bands, modes, continents } from "@/filters_data.js";
import { useFilters } from "../hooks/useFilters";
import { get_flag } from "@/flags.js";

import { useState, useEffect, useRef, useMemo } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
import { useLocalStorage, useMediaQuery } from "@uidotdev/usehooks";

function connect_to_radio() {
    const host = window.location.host;
    const protocol = window.location.protocol;
    const websocket_url = (protocol == "https:" ? "wss:" : "ws:") + "//" + host + "/radio";

    const { sendJsonMessage, readyState, lastJsonMessage } = useWebSocket(websocket_url);
    const [radio_status, set_radio_status] = useState("unknown");
    const [radio_freq, set_radio_freq] = useState(0);
    const [rig, set_rig] = useState(1);

    useEffect(() => {
        if (lastJsonMessage != null) {
            if ("status" in lastJsonMessage) {
                set_radio_status(lastJsonMessage.status);
                set_radio_freq(lastJsonMessage.freq);
                set_rig(lastJsonMessage.current_rig);
            }
        }
    }, [lastJsonMessage]);

    const send_message_to_radio = message => {
        if (readyState == ReadyState.OPEN) {
            sendJsonMessage(message);
        }
    };

    return {
        send_message_to_radio: send_message_to_radio,
        radio_status: radio_status,
        radio_freq: radio_freq,
        rig: rig,
    };
}

function fetch_spots() {
    if (this.is_fetching_in_progress) {
        return;
    }

    let url;
    // For debugging purposes
    if (window.location.port == "5173") {
        url = "https://holycluster.iarc.org/spots";
    } else {
        url = "/spots";
    }
    if (this.last_timestamp != null) {
        url += `?since=${this.last_timestamp}`;
    }

    if (!navigator.onLine) {
        this.set_network_state("disconnected");
    } else {
        this.is_fetching_in_progress = true;
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
                    const new_spots = data.map(spot => {
                        if (spot.mode == "DIGITAL") {
                            spot.mode = "DIGI";
                        }
                        return spot;
                    });
                    let spots = new_spots.concat(this.spots);
                    spots.sort((spot_a, spot_b) => spot_b.time - spot_a.time);
                    let current_time = Math.round(Date.now() / 1000);
                    spots = spots.filter(spot => spot.time > current_time - 3600);
                    this.last_timestamp = spots[0].time;
                    this.set_spots(spots);
                    this.set_network_state("connected");
                }
                this.is_fetching_in_progress = false;
            })
            .catch(_ => {
                this.set_network_state("disconnected");
                this.is_fetching_in_progress = false;
            });
    }
}

function fetch_propagation() {
    let url;
    // For debugging purposes
    if (window.location.port == "5173") {
        url = "https://holycluster.iarc.org/propagation";
    } else {
        url = "/propagation";
    }

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

function MainContainer() {
    const [toggled_ui, set_toggled_ui] = useState({ left: true, right: true });

    const { filters, callsign_filters } = useFilters();

    let show_only_filters = callsign_filters.filters.filter(filter => filter.action == "show_only");
    let hide_filters = callsign_filters.filters.filter(filter => filter.action == "hide");
    let alerts = callsign_filters.filters.filter(filter => filter.action == "alert");

    const [map_controls, set_map_controls_inner] = use_object_local_storage("map_controls", {
        night: false,
        location: {
            displayed_locator: "JJ00AA",
            // Longitude, latitude
            location: [0, 0],
        },
    });

    const [cat_control, set_cat_control] = useLocalStorage("freq_bar_cat_control", true);

    const set_map_controls = change_func => {
        set_map_controls_inner(previous_state => {
            const state = structuredClone(previous_state);
            change_func(state);
            return state;
        });
    };

    const [settings, set_settings] = use_object_local_storage("settings", {
        locator: "JJ00AA",
        default_radius: 20000,
        theme: "Light",
        callsign: "",
        is_miles: false,
        propagation_displayed: true,
    });

    const [table_sort, set_table_sort] = use_object_local_storage("table_sort", {
        column: "time",
        ascending: false,
    });

    const [radius_in_km, set_radius_in_km] = useState(settings.default_radius);

    const current_time = new Date().getTime() / 1000;

    const [spots, set_spots] = useState([]);
    const [propagation, set_propagation] = useState();

    const [network_state, set_network_state] = useState("connecting");

    const fetch_spots_context = useRef({
        spots,
        set_spots,
        set_network_state,
        last_timestamp: null,
    });
    // This is very importent because the spots are later sorted
    fetch_spots_context.current.spots = structuredClone(spots);

    const fetch_propagation_context = useRef({
        propagation,
        set_propagation,
    });
    fetch_propagation_context.current.propagation = propagation;

    useEffect(() => {
        const fetch_spots_with_context = fetch_spots.bind(fetch_spots_context.current);
        fetch_spots_with_context();
        let spots_interval_id = setInterval(fetch_spots_with_context, 30 * 1000);

        const fetch_propagation_with_context = fetch_propagation.bind(
            fetch_propagation_context.current,
        );
        fetch_propagation_with_context();
        let propagation_interval_id = setInterval(fetch_propagation_with_context, 3600 * 1000);

        // Try to fetch again the spots when the device is connected to the internet
        const handle_online = () => {
            set_network_state("connecting");
            fetch_spots_with_context();
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
            clearInterval(spots_interval_id);
            clearInterval(propagation_interval_id);
        };
    }, []);

    for (const spot of spots) {
        spot.is_alerted =
            is_matching_list(alerts, spot) && callsign_filters.is_alert_filters_active;
    }

    const [filter_missing_flags, set_filter_missing_flags] = useState(false);
    const [dev_mode, set_dev_mode] = useLocalStorage("dev_mode", false);

    const filtered_spots = spots
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

            const is_band_and_mode_active = filters.bands[spot.band] && filters.modes[spot.mode];

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
            const is_spotter_continent_active = filters.spotter_continents[spot.spotter_continent];

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

    filtered_spots.sort((spot_a, spot_b) => {
        // Sorting by frequency should be always more accurate
        const column = table_sort.column == "band" ? "freq" : table_sort.column;

        const value_a = spot_a[column];
        const value_b = spot_b[column];
        if (typeof value_a == "string" && typeof value_b == "string") {
            let comparison = table_sort.ascending ? value_a.localeCompare(value_b) : value_b.localeCompare(value_a);
            if (comparison == 0) {
                comparison = spot_b.time - spot_a.time;
            }
            return comparison;
        } else if (typeof value_b == "number" && typeof value_a == "number") {
            let comparison = table_sort.ascending ? value_a - value_b : value_b - value_a;

            // These are secondary sorting by dx callsign and spotter callsign, to ensure that the
            // order is consistent. It looks like returning 0 can cause a random order.
            if (comparison == 0) {
                comparison = spot_a.dx_callsign.localeCompare(spot_b.dx_callsign);
            }
            if (comparison == 0) {
                comparison = spot_a.spotter_callsign.localeCompare(spot_b.spotter_callsign);
            }
            return comparison;
        } else {
            console.log(
                `Bad values of column ${table_sort.column}`,
                value_a,
                value_b,
                spot_a,
                spot_b,
            );
        }
    });

    const spots_per_band_count = Object.fromEntries(
        bands.map(band => [band, filtered_spots.filter(spot => spot.band == band).length]),
    );

    // Limit the count for 2 digit display
    for (const band in spots_per_band_count) {
        spots_per_band_count[band] = Math.min(spots_per_band_count[band], 99);
    }

    let { send_message_to_radio, radio_status, radio_freq, rig } = connect_to_radio();

    function set_cat_to_spot(spot) {
        if (cat_control != true) {
            return;
        }

        send_message_to_radio({
            mode: spot.mode,
            freq: spot.freq,
            band: spot.band,
        });
    }

    function set_rig(rig) {
        if (![1, 2].includes(rig)) {
            return;
        }

        send_message_to_radio({
            rig: rig,
        });
    }

    let [hovered_spot, set_hovered_spot] = useState({ source: null, id: null });
    let [pinned_spot, set_pinned_spot] = useState(null);

    const [canvas, set_canvas] = useLocalStorage("canvas", false);

    function on_key_down(event) {
        if (event.key == "Escape") {
            set_pinned_spot(null);
        }

        if (event.ctrlKey && event.altKey) {
            if (event.key == "c") {
                set_canvas(!canvas);
            } else if (event.key == "f") {
                set_filter_missing_flags(!filter_missing_flags);
            } else if (event.key == "p") {
                set_dev_mode(!dev_mode);
            }
        }
    }

    useEffect(() => {
        document.body.addEventListener("keydown", on_key_down);
        return () => {
            document.body.removeEventListener("keydown", on_key_down);
        };
    });

    const is_md_device = useMediaQuery("only screen and (max-width : 768px)");

    const map = (
        <div className="relative h-full w-full">
            <MapControls
                home_locator={settings.locator}
                map_controls={map_controls}
                set_map_controls={set_map_controls}
                radio_status={radio_status}
                cat_status={cat_control}
                default_radius={settings.default_radius}
                set_radius_in_km={set_radius_in_km}
                settings={settings}
                propagation={propagation}
            />
            {canvas ? (
                <CanvasMap
                    spots={filtered_spots}
                    map_controls={map_controls}
                    set_map_controls={set_map_controls}
                    set_cat_to_spot={set_cat_to_spot}
                    hovered_spot={hovered_spot}
                    set_hovered_spot={set_hovered_spot}
                    pinned_spot={pinned_spot}
                    set_pinned_spot={set_pinned_spot}
                    settings={settings}
                />
            ) : (
                <SvgMap
                    spots={filtered_spots}
                    map_controls={map_controls}
                    set_map_controls={set_map_controls}
                    set_cat_to_spot={set_cat_to_spot}
                    hovered_spot={hovered_spot}
                    set_hovered_spot={set_hovered_spot}
                    pinned_spot={pinned_spot}
                    set_pinned_spot={set_pinned_spot}
                    radius_in_km={radius_in_km}
                    set_radius_in_km={set_radius_in_km}
                    settings={settings}
                />
            )}
        </div>
    );

    const table = (
        <SpotsTable
            spots={filtered_spots}
            hovered_spot={hovered_spot}
            set_hovered_spot={set_hovered_spot}
            pinned_spot={pinned_spot}
            set_pinned_spot={set_pinned_spot}
            set_cat_to_spot={set_cat_to_spot}
            table_sort={table_sort}
            set_table_sort={set_table_sort}
            dev_mode={dev_mode}
        />
    );

    return (
        <>
            <TopBar
                filters={filters}
                settings={settings}
                set_settings={set_settings}
                set_map_controls={set_map_controls}
                set_radius_in_km={set_radius_in_km}
                network_state={network_state}
                toggled_ui={toggled_ui}
                set_toggled_ui={set_toggled_ui}
                dev_mode={dev_mode}
                radio_status={radio_status}
                radio_freq={radio_freq}
                rig={rig}
                set_rig={set_rig}
            />
            <div className="flex relative h-[calc(100%-4rem)]">
                <LeftColumn
                    filters={filters}
                    spots_per_band_count={spots_per_band_count}
                    toggled_ui={toggled_ui}
                />
                {is_md_device ? (
                    <Tabs
                        local_storage_name="mobile_tab"
                        tabs={[
                            {
                                label: "Map",
                                content: map,
                                bg: "bg-blue-100",
                                icon: "M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m7.5-6.923c-.67.204-1.335.82-1.887 1.855A8 8 0 0 0 5.145 4H7.5zM4.09 4a9.3 9.3 0 0 1 .64-1.539 7 7 0 0 1 .597-.933A7.03 7.03 0 0 0 2.255 4zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.674a7 7 0 0 0-.656 2.5zM4.847 5a12.5 12.5 0 0 0-.338 2.5H7.5V5zM8.5 5v2.5h2.99a12.5 12.5 0 0 0-.337-2.5zM4.51 8.5a12.5 12.5 0 0 0 .337 2.5H7.5V8.5zm3.99 0V11h2.653c.187-.765.306-1.608.338-2.5zM5.145 12q.208.58.468 1.068c.552 1.035 1.218 1.65 1.887 1.855V12zm.182 2.472a7 7 0 0 1-.597-.933A9.3 9.3 0 0 1 4.09 12H2.255a7 7 0 0 0 3.072 2.472M3.82 11a13.7 13.7 0 0 1-.312-2.5h-2.49c.062.89.291 1.733.656 2.5zm6.853 3.472A7 7 0 0 0 13.745 12H11.91a9.3 9.3 0 0 1-.64 1.539 7 7 0 0 1-.597.933M8.5 12v2.923c.67-.204 1.335-.82 1.887-1.855q.26-.487.468-1.068zm3.68-1h2.146c.365-.767.594-1.61.656-2.5h-2.49a13.7 13.7 0 0 1-.312 2.5m2.802-3.5a7 7 0 0 0-.656-2.5H12.18c.174.782.282 1.623.312 2.5zM11.27 2.461c.247.464.462.98.64 1.539h1.835a7 7 0 0 0-3.072-2.472c.218.284.418.598.597.933M10.855 4a8 8 0 0 0-.468-1.068C9.835 1.897 9.17 1.282 8.5 1.077V4z",
                            },
                            {
                                label: "Table",
                                bg: "bg-red-200",
                                content: table,
                                icon: "M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm15 2h-4v3h4zm0 4h-4v3h4zm0 4h-4v3h3a1 1 0 0 0 1-1zm-5 3v-3H6v3zm-5 0v-3H1v2a1 1 0 0 0 1 1zm-4-4h4V8H1zm0-4h4V4H1zm5-3v3h4V4zm4 4H6v3h4z",
                            },
                        ]}
                    ></Tabs>
                ) : (
                    <>
                        {map}
                        {table}
                    </>
                )}

                <CallsignsView
                    toggled_ui={toggled_ui}
                    spots={filtered_spots}
                    pinned_spot={pinned_spot}
                    set_pinned_spot={set_pinned_spot}
                    radio_status={radio_status}
                    radio_freq={Math.round(radio_freq / 1000)}
                    set_cat_to_spot={set_cat_to_spot}
                    cat_control={cat_control}
                    set_cat_control={set_cat_control}
                    hovered_spot={hovered_spot}
                    set_hovered_spot={set_hovered_spot}
                />

                <Continents toggled_ui={toggled_ui} />
            </div>
        </>
    );
}

export default MainContainer;

import SvgMap from "@/components/SvgMap.jsx";
import CanvasMap from "@/components/CanvasMap/index.jsx";
import MapControls from "@/components/MapControls.jsx";
import TopBar from "@/components/TopBar.jsx";
import SpotsTable from "@/components/SpotsTable.jsx";
import Continents from "@/components/Continents.jsx";
import LeftColumn from "@/components/LeftColumn.jsx";
import CallsignsView from "@/components/CallsignsView.jsx";
import Tabs from "@/components/Tabs.jsx";
import { use_object_local_storage, is_matching_list, get_max_radius } from "@/utils.js";
import { bands, modes, continents } from "@/filters_data.js";
import { useFilters } from "@/hooks/useFilters";
import { useServerData } from "@/hooks/useServerData";
import use_radio from "@/hooks/useRadio";

import { useState, useEffect, useRef, useMemo } from "react";
import { useLocalStorage, useMediaQuery } from "@uidotdev/usehooks";

function MainContainer() {
    const [toggled_ui, set_toggled_ui] = useState({ left: true, right: true });

    const { spots, set_pinned_spot, filter_missing_flags, set_filter_missing_flags } =
        useServerData();

    const [map_controls, set_map_controls_inner] = use_object_local_storage("map_controls", {
        night: false,
        location: {
            displayed_locator: "JJ00AA",
            // Longitude, latitude
            location: [0, 0],
        },
    });

    const [cat_control, set_cat_control] = useLocalStorage("freq_bar_cat_control", true);
    const [prev_freqs, set_prev_freqs] = useState([]);
    const prev_freq_limit = 1; // Set the max number of undos a user can do

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
        show_flags: true,
        show_equator: false,
    });

    const [table_sort, set_table_sort] = use_object_local_storage("table_sort", {
        column: "time",
        ascending: false,
    });

    const [dev_mode, set_dev_mode] = useLocalStorage("dev_mode", false);

    const max_radius = get_max_radius(map_controls.location.location, spots);

    const [radius_in_km, set_radius_in_km] = useState(settings.default_radius);
    const [auto_radius, set_auto_radius] = useLocalStorage("auto_radius", true);
    useEffect(() => {
        if (max_radius > 0 && auto_radius) {
            set_radius_in_km(Math.round((max_radius + 500) / 1000) * 1000);
        }
    }, [max_radius, auto_radius, map_controls.location]);

    spots.sort((spot_a, spot_b) => {
        // Sorting by frequency should be always more accurate
        const column = table_sort.column == "band" ? "freq" : table_sort.column;

        const value_a = spot_a[column];
        const value_b = spot_b[column];
        if (typeof value_a == "string" && typeof value_b == "string") {
            let comparison = table_sort.ascending
                ? value_a.localeCompare(value_b)
                : value_b.localeCompare(value_a);
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

    const { send_message_to_radio, radio_status, radio_freq, rig, radio_mode, radio_band } =
        use_radio();

    function set_cat_to_spot(spot) {
        if (cat_control != true) {
            return;
        }

        set_prev_freqs(
            [
                {
                    band: radio_band,
                    mode: radio_mode,
                    freq: Math.round((radio_freq / 1000) * 10) / 10,
                },
            ]
                .concat(prev_freqs)
                .slice(0, prev_freq_limit),
        );

        send_message_to_radio({
            mode: spot.mode,
            freq: spot.freq,
            band: spot.band,
        });
    }

    function undo_freq_change() {
        if (prev_freqs.length <= 0 || cat_control != true) {
            return;
        }

        send_message_to_radio(prev_freqs[0]);
        set_prev_freqs(prev_freqs.slice(1));
    }

    function set_rig(rig) {
        if (![1, 2].includes(rig)) {
            return;
        }

        send_message_to_radio({
            rig: rig,
        });
    }

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
                can_undo_cat={prev_freqs.length > 0}
                undo_cat={undo_freq_change}
            />
            {canvas ? (
                <CanvasMap
                    map_controls={map_controls}
                    set_map_controls={set_map_controls}
                    set_cat_to_spot={set_cat_to_spot}
                    settings={settings}
                />
            ) : (
                <SvgMap
                    map_controls={map_controls}
                    set_map_controls={set_map_controls}
                    set_cat_to_spot={set_cat_to_spot}
                    radius_in_km={radius_in_km}
                    set_radius_in_km={set_radius_in_km}
                    settings={settings}
                    auto_radius={auto_radius}
                    set_auto_radius={set_auto_radius}
                />
            )}
        </div>
    );

    const table = (
        <SpotsTable
            set_cat_to_spot={set_cat_to_spot}
            settings={settings}
            table_sort={table_sort}
            set_table_sort={set_table_sort}
        />
    );

    return (
        <>
            <TopBar
                settings={settings}
                set_settings={set_settings}
                set_map_controls={set_map_controls}
                set_radius_in_km={set_radius_in_km}
                toggled_ui={toggled_ui}
                set_toggled_ui={set_toggled_ui}
                dev_mode={dev_mode}
                radio_status={radio_status}
                rig={rig}
                set_rig={set_rig}
            />
            <div className="flex relative h-[calc(100%-4rem)]">
                <LeftColumn toggled_ui={toggled_ui} />
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
                    radio_status={radio_status}
                    set_cat_to_spot={set_cat_to_spot}
                    cat_control={cat_control}
                    set_cat_control={set_cat_control}
                />

                <Continents toggled_ui={toggled_ui} />
            </div>
        </>
    );
}

export default MainContainer;

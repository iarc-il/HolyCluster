import CanvasMap from "@/components/CanvasMap/index.jsx";
import LeftColumn from "@/components/LeftColumn.jsx";
import MapControls from "@/components/MapControls.jsx";
import SidePanel from "@/components/SidePanel.jsx";
import SpotsTable from "@/components/SpotsTable.jsx";
import TopBar from "@/components/TopBar.jsx";
import UnsupportedVersion from "@/components/UnsupportedVersion.jsx";
import { UpdateConsentDialog } from "@/components/UpdateControls.jsx";
import HistoryBar from "@/components/history/HistoryBar.jsx";
import WebsiteTour from "@/components/tour/WebsiteTour.jsx";
import {
    TOUR_CLOSE_LEFT_PANEL_EVENT,
    TOUR_CLOSE_SIDE_PANEL_EVENT,
} from "@/components/tour/tour_events.js";
import Tabs from "@/components/ui/Tabs.jsx";
import { useColors } from "@/hooks/useColors";
import { useProfiles } from "@/hooks/useProfiles.jsx";
import use_radio from "@/hooks/useRadio";
import { RestDataProvider } from "@/hooks/useRestData";
import useRotator from "@/hooks/useRotator";
import { SpotDataProvider, useSpotData } from "@/hooks/useSpotData";
import { useSpotInteraction } from "@/hooks/useSpotInteraction";
import {
    calculate_bearing_between_locations,
    compare_version,
    get_bearing_origin,
    get_max_radius,
    get_spots_center,
} from "@/utils.js";
import { open_db_and_evict as open_db_and_evict_propagation } from "@/utils/propagation_cache_db.jsx";
import { open_db_and_evict as open_db_and_evict_spots } from "@/utils/spot_cache_db.jsx";
import Maidenhead from "maidenhead";

import { useDebounce, useLocalStorage, useMediaQuery } from "@uidotdev/usehooks";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const AUTO_RADIUS_PADDING_KM = 1000;
const AUTO_RADIUS_RECENTER_ENABLED = false;
const HISTORY_FETCH_DEBOUNCE_MS = 300;
const MAP_TAB_ICON =
    "M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m7.5-6.923c-.67.204-1.335.82-1.887 1.855A8 8 0 0 0 5.145 4H7.5zM4.09 4a9.3 9.3 0 0 1 .64-1.539 7 7 0 0 1 .597-.933A7.03 7.03 0 0 0 2.255 4zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.674a7 7 0 0 0-.656 2.5zM4.847 5a12.5 12.5 0 0 0-.338 2.5H7.5V5zM8.5 5v2.5h2.99a12.5 12.5 0 0 0-.337-2.5zM4.51 8.5a12.5 12.5 0 0 0 .337 2.5H7.5V8.5zm3.99 0V11h2.653c.187-.765.306-1.608.338-2.5zM5.145 12q.208.58.468 1.068c.552 1.035 1.218 1.65 1.887 1.855V12zm.182 2.472a7 7 0 0 1-.597-.933A9.3 9.3 0 0 1 4.09 12H2.255a7 7 0 0 0 3.072 2.472M3.82 11a13.7 13.7 0 0 1-.312-2.5h-2.49c.062.89.291 1.733.656 2.5zm6.853 3.472A7 7 0 0 0 13.745 12H11.91a9.3 9.3 0 0 1-.64 1.539 7 7 0 0 1-.597.933M8.5 12v2.923c.67-.204 1.335-.82 1.887-1.855q.26-.487.468-1.068zm3.68-1h2.146c.365-.767.594-1.61.656-2.5h-2.49a13.7 13.7 0 0 1-.312 2.5m2.802-3.5a7 7 0 0 0-.656-2.5H12.18c.174.782.282 1.623.312 2.5zM11.27 2.461c.247.464.462.98.64 1.539h1.835a7 7 0 0 0-3.072-2.472c.218.284.418.598.597.933M10.855 4a8 8 0 0 0-.468-1.068C9.835 1.897 9.17 1.282 8.5 1.077V4z";
const TABLE_TAB_ICON =
    "M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm15 2h-4v3h4zm0 4h-4v3h4zm0 4h-4v3h3a1 1 0 0 0 1-1zm-5 3v-3H6v3zm-5 0v-3H1v2a1 1 0 0 0 1 1zm-4-4h4V8H1zm0-4h4V4H1zm5-3v3h4V4zm4 4H6v3h4z";

function MainContent({
    history_start,
    history_end,
    set_history_start,
    set_history_end,
    window_size_ms,
    set_window_size_ms,
    display_hours,
    is_dragging,
    set_is_dragging,
}) {
    const { dev_mode, set_dev_mode, colors } = useColors();

    useEffect(() => {
        document.body.style.backgroundColor = colors.theme.background;
    }, [colors.theme.background]);
    const [toggled_ui, set_toggled_ui] = useState({ left_visible: true, right_visible: true });
    const { local_version } = use_radio();
    const {
        active_profile_data: {
            settings,
            map_controls,
            map_view: { auto_radius, radius_in_km },
            table_sort,
        },
        update_active_profile_section,
    } = useProfiles();
    const {
        spots,
        filter_missing_flags,
        set_filter_missing_flags,
        committed_start: spots_committed_start,
        committed_end: spots_committed_end,
    } = useSpotData();
    const { set_pinned_spot } = useSpotInteraction();
    const is_history_mode = dev_mode && !!(history_start && history_end);

    // Bar position and the map's night overlay should never visibly move ahead
    // of the spots actually drawn on the map. While dragging, track the raw
    // target instantly (no data needed for that). Otherwise only adopt a new
    // position once useHistorySpots has committed data for that *exact* range
    // — comparing against a generic "fetch_state === done" would be unreliable
    // here (that flag can still read "done" from the previous range for a
    // moment after a new one is requested), so committed_start/end (only ever
    // set at the instant their own matching fetch resolves) is what we key off
    // instead. Never regress to a stale committed value either: keep showing
    // whatever was last displayed until the new commit lands.
    const [displayed_window, set_displayed_window] = useState({ start: null, end: null });
    useLayoutEffect(() => {
        set_displayed_window(current => {
            if (!is_history_mode) return { start: null, end: null };
            if (is_dragging) {
                return { start: history_start, end: history_end };
            }
            const committed_matches_target =
                spots_committed_start &&
                spots_committed_end &&
                history_start &&
                history_end &&
                spots_committed_start.getTime() === history_start.getTime() &&
                spots_committed_end.getTime() === history_end.getTime();
            if (committed_matches_target) {
                return { start: spots_committed_start, end: spots_committed_end };
            }
            if (!current.end) {
                return { start: history_start, end: history_end };
            }
            return current;
        });
    }, [
        is_history_mode,
        is_dragging,
        spots_committed_start,
        spots_committed_end,
        history_start,
        history_end,
    ]);
    // Fall back to the raw target on the very first render after toggling
    // history on, before this component's own layout effect has had a chance
    // to run once — otherwise HistoryBar briefly receives null.
    const display_start = displayed_window.start ?? history_start;
    const display_end = displayed_window.end ?? history_end;

    const [prev_freqs, set_prev_freqs] = useState([]);
    const prev_freq_limit = 1; // Set the max number of undos a user can do
    const map_wrapper_ref = useRef(null);
    const [is_map_fullscreen, set_is_map_fullscreen] = useState(false);

    const set_map_controls = change_func => {
        update_active_profile_section("map_controls", previous_state => {
            const state = structuredClone(previous_state);
            change_func(state);
            return state;
        });
    };

    function set_table_sort(value_or_setter) {
        update_active_profile_section("table_sort", value_or_setter);
    }

    function set_auto_radius(value_or_setter) {
        update_active_profile_section("map_view", map_view => ({
            ...map_view,
            auto_radius:
                typeof value_or_setter === "function"
                    ? value_or_setter(map_view.auto_radius)
                    : value_or_setter,
        }));
    }

    function set_radius_in_km(value_or_setter) {
        update_active_profile_section("map_view", map_view => ({
            ...map_view,
            radius_in_km:
                typeof value_or_setter === "function"
                    ? value_or_setter(map_view.radius_in_km)
                    : value_or_setter,
        }));
    }

    const max_radius = get_max_radius(map_controls.location.location, spots);

    const prev_auto_radius_ref = useRef(auto_radius);
    useEffect(() => {
        const just_activated = auto_radius && !prev_auto_radius_ref.current;
        prev_auto_radius_ref.current = auto_radius;

        if (max_radius > 0 && auto_radius) {
            if (AUTO_RADIUS_RECENTER_ENABLED && just_activated) {
                const center = get_spots_center(spots);
                if (center) {
                    const [lon, lat] = center;
                    const displayed_locator = new Maidenhead(lat, lon).locator.slice(0, 6);
                    set_map_controls(state => {
                        state.location = { displayed_locator, location: [lon, lat] };
                    });
                }
            }
            set_radius_in_km(Math.ceil((max_radius + AUTO_RADIUS_PADDING_KM) / 1000) * 1000);
        }
    }, [max_radius, auto_radius]);

    const { set_mode_and_freq, radio_freq, rig, radio_mode } = use_radio();
    const { set_azimuth, is_rotator_available } = useRotator();

    function get_rotator_azimuth(spot) {
        if (!spot?.dx_loc) {
            return null;
        }

        try {
            const origin = get_bearing_origin(settings, map_controls.location.location);
            return calculate_bearing_between_locations(origin.location, spot.dx_loc);
        } catch {
            return null;
        }
    }

    function set_cat_to_spot(spot) {
        set_prev_freqs(
            [
                {
                    mode: radio_mode,
                    freq: Math.round((radio_freq / 1000) * 10) / 10,
                },
            ]
                .concat(prev_freqs)
                .slice(0, prev_freq_limit),
        );

        set_mode_and_freq(spot.mode, spot.freq);

        if (dev_mode) {
            const azimuth = get_rotator_azimuth(spot);
            if (azimuth != null && is_rotator_available()) {
                set_azimuth(azimuth);
            }
        }
    }

    function undo_freq_change() {
        if (prev_freqs.length <= 0) {
            return;
        }

        set_mode_and_freq(prev_freqs[0].mode, prev_freqs[0].freq);
        set_prev_freqs(prev_freqs.slice(1));
    }

    // The view with zero index is the Filters view
    const [active_view, set_active_view] = useLocalStorage("active_view", 0);

    function on_key_down(event) {
        if (event.key === "Escape") {
            set_pinned_spot(null);
        }

        if (event.ctrlKey && event.altKey) {
            if (event.key === "f") {
                set_filter_missing_flags(!filter_missing_flags);
            } else if (event.key === "p" || event.key === "s") {
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

    useEffect(() => {
        function close_left_panel_for_tour() {
            set_toggled_ui(state => ({ ...state, left_visible: false }));
        }

        function close_side_panel_for_tour() {
            set_toggled_ui(state => ({ ...state, right_visible: false }));
        }

        document.addEventListener(TOUR_CLOSE_LEFT_PANEL_EVENT, close_left_panel_for_tour);
        document.addEventListener(TOUR_CLOSE_SIDE_PANEL_EVENT, close_side_panel_for_tour);
        return () => {
            document.removeEventListener(TOUR_CLOSE_LEFT_PANEL_EVENT, close_left_panel_for_tour);
            document.removeEventListener(TOUR_CLOSE_SIDE_PANEL_EVENT, close_side_panel_for_tour);
        };
    }, []);

    useEffect(() => {
        function handle_fullscreen_change() {
            set_is_map_fullscreen(document.fullscreenElement === map_wrapper_ref.current);
        }

        document.addEventListener("fullscreenchange", handle_fullscreen_change);
        return () => {
            document.removeEventListener("fullscreenchange", handle_fullscreen_change);
        };
    }, []);

    function toggle_map_fullscreen() {
        if (!map_wrapper_ref.current) {
            return;
        }

        if (document.fullscreenElement === map_wrapper_ref.current) {
            document.exitFullscreen();
            return;
        }

        map_wrapper_ref.current.requestFullscreen();
    }

    const is_md_device = useMediaQuery("only screen and (max-width : 768px)");

    function toggle_history() {
        if (!dev_mode) return;

        if (is_history_mode) {
            set_history_start(null);
            set_history_end(null);
        } else {
            const bar_start_ms = Date.now() - display_hours * 3_600_000;
            set_history_start(new Date(bar_start_ms));
            set_history_end(new Date(bar_start_ms + window_size_ms));
        }
    }

    const map = (
        <div
            ref={map_wrapper_ref}
            className={`relative h-full w-full ${is_map_fullscreen ? "fixed inset-0 z-[80]" : ""}`}
            style={{ backgroundColor: colors.theme.background }}
        >
            <MapControls
                map_controls={map_controls}
                set_map_controls={set_map_controls}
                set_radius_in_km={set_radius_in_km}
                can_undo_cat={prev_freqs.length > 0}
                undo_cat={undo_freq_change}
                is_map_fullscreen={is_map_fullscreen}
                toggle_map_fullscreen={toggle_map_fullscreen}
                is_mobile={is_md_device}
                is_history_mode={is_history_mode}
                toggle_history={toggle_history}
            />
            <CanvasMap
                map_controls={map_controls}
                set_map_controls={set_map_controls}
                set_cat_to_spot={set_cat_to_spot}
                radius_in_km={radius_in_km}
                set_radius_in_km={set_radius_in_km}
                auto_radius={auto_radius}
                set_auto_radius={set_auto_radius}
                night_time={is_history_mode ? display_end : null}
            />
        </div>
    );

    const table =
        compare_version(local_version, [1, 0, 0, 0]) > 0 || local_version == null ? (
            <SpotsTable
                set_cat_to_spot={set_cat_to_spot}
                table_sort={table_sort}
                set_table_sort={set_table_sort}
            />
        ) : (
            <UnsupportedVersion />
        );

    const main_view_mode = settings.main_view_mode ?? "both";
    const main_view_order = settings.main_view_order ?? "map_table";
    const ordered_panel_keys =
        main_view_order === "table_map" ? ["table", "map"] : ["map", "table"];
    const active_panel_keys =
        main_view_mode === "map"
            ? ["map"]
            : main_view_mode === "table"
              ? ["table"]
              : ordered_panel_keys;
    const desktop_panel_widths =
        main_view_mode === "both"
            ? {
                  map: "flex-[0_0_57%]",
                  table: "flex-[0_0_43%]",
              }
            : {
                  map: "flex-1",
                  table: "flex-1",
              };
    const main_panel_content = {
        map,
        table,
    };
    const mobile_tab_by_panel = {
        map: {
            label: "Map",
            content: map,
            data_tour: "mobile-main-tab-map",
            icon: MAP_TAB_ICON,
            viewbox: "0 0 16 16",
            size: "16",
        },
        table: {
            label: "Table",
            content: table,
            data_tour: "mobile-main-tab-table",
            icon: TABLE_TAB_ICON,
            viewbox: "0 0 16 16",
            size: "16",
        },
    };
    const mobile_tabs = active_panel_keys.map(panel_key => mobile_tab_by_panel[panel_key]);
    const mobile_tabs_key = `${main_view_mode}-${main_view_order}`;

    return (
        <div className="flex flex-col h-full" data-tour="app-shell">
            <UpdateConsentDialog />
            <TopBar
                set_map_controls={set_map_controls}
                set_radius_in_km={set_radius_in_km}
                toggled_ui={toggled_ui}
                set_toggled_ui={set_toggled_ui}
                dev_mode={dev_mode}
            />
            <div className="flex flex-col flex-1 min-h-0" data-tour="main-content">
                <div className="flex relative flex-1 min-h-0" data-tour="main-workspace">
                    <LeftColumn toggled_ui={toggled_ui}>
                        <WebsiteTour />
                    </LeftColumn>
                    {is_md_device ? (
                        <Tabs
                            key={mobile_tabs_key}
                            local_storage_name={mobile_tabs.length > 1 ? "mobile_tab" : null}
                            tabs={mobile_tabs}
                            data_tour="mobile-main-tabs"
                        />
                    ) : (
                        <div className="flex flex-1 min-w-0 h-full">
                            {active_panel_keys.map(panel_key => (
                                <div
                                    key={panel_key}
                                    className={`${desktop_panel_widths[panel_key]} min-w-0 h-full`}
                                    data-tour={`${panel_key}-panel`}
                                >
                                    {main_panel_content[panel_key]}
                                </div>
                            ))}
                        </div>
                    )}
                    <SidePanel
                        toggled_ui={toggled_ui}
                        set_toggled_ui={set_toggled_ui}
                        set_cat_to_spot={set_cat_to_spot}
                        active_view={active_view}
                        set_active_view={set_active_view}
                    />
                </div>
                {is_history_mode && (
                    <HistoryBar
                        start={history_start}
                        end={history_end}
                        display_start={display_start}
                        display_end={display_end}
                        set_start={set_history_start}
                        set_end={set_history_end}
                        window_size_ms={window_size_ms}
                        set_window_size_ms={set_window_size_ms}
                        set_is_dragging={set_is_dragging}
                    />
                )}
            </div>
        </div>
    );
}

function MainContainer() {
    const { dev_mode } = useColors();
    const {
        active_profile_data: {
            history: { window_size_ms, step_size_ms, display_hours },
        },
        update_active_profile_section,
    } = useProfiles();
    const [history_start, set_history_start] = useState(null);
    const [history_end, set_history_end] = useState(null);
    const [is_dragging, set_is_dragging] = useState(false);
    const effective_history_start = dev_mode ? history_start : null;
    const effective_history_end = dev_mode ? history_end : null;
    const debounced_history_start = useDebounce(effective_history_start, HISTORY_FETCH_DEBOUNCE_MS);
    const debounced_history_end = useDebounce(effective_history_end, HISTORY_FETCH_DEBOUNCE_MS);
    // Debounce only smooths out drag-induced fetch spam; any other change
    // (step/play/preset) should hit the fetch hooks immediately.
    const fetch_history_start = is_dragging ? debounced_history_start : effective_history_start;
    const fetch_history_end = is_dragging ? debounced_history_end : effective_history_end;

    function set_window_size_ms(value_or_setter) {
        update_active_profile_section("history", history => ({
            ...history,
            window_size_ms:
                typeof value_or_setter === "function"
                    ? value_or_setter(history.window_size_ms)
                    : value_or_setter,
        }));
    }

    useEffect(() => {
        if (!dev_mode) {
            set_history_start(null);
            set_history_end(null);
        }
    }, [dev_mode]);

    useEffect(() => {
        if (!dev_mode) return;

        const evict_all = () => {
            open_db_and_evict_spots();
            open_db_and_evict_propagation();
        };

        const handle =
            typeof requestIdleCallback !== "undefined"
                ? requestIdleCallback(() => evict_all())
                : setTimeout(() => evict_all(), 2000);
        const timer = setInterval(() => evict_all(), 3 * 60 * 60_000);
        return () => {
            typeof requestIdleCallback !== "undefined"
                ? cancelIdleCallback(handle)
                : clearTimeout(handle);
            clearInterval(timer);
        };
    }, [dev_mode]);

    return (
        <RestDataProvider
            propagation_range_start={fetch_history_start}
            propagation_range_end={fetch_history_end}
            propagation_time={fetch_history_end}
        >
            <SpotDataProvider
                startTime={fetch_history_start}
                endTime={fetch_history_end}
                window_size_ms={window_size_ms}
                step_size_ms={step_size_ms}
            >
                <MainContent
                    history_start={effective_history_start}
                    history_end={effective_history_end}
                    set_history_start={set_history_start}
                    set_history_end={set_history_end}
                    window_size_ms={window_size_ms}
                    set_window_size_ms={set_window_size_ms}
                    display_hours={display_hours}
                    is_dragging={is_dragging}
                    set_is_dragging={set_is_dragging}
                />
            </SpotDataProvider>
        </RestDataProvider>
    );
}

export default MainContainer;

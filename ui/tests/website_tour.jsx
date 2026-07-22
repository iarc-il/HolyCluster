import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WebsiteTour from "@/components/tour/WebsiteTour.jsx";
import {
    TOUR_CLOSE_LEFT_PANEL_EVENT,
    TOUR_CLOSE_MAP_CONTROLS_EVENT,
    TOUR_CLOSE_MODAL_EVENT,
    TOUR_CLOSE_SIDE_PANEL_EVENT,
    TOUR_FILTER_OPTIONS_EVENT,
    TOUR_TABLE_CONTEXT_MENU_EVENT,
    TOUR_TABLE_SPOT_ROW_EVENT,
} from "@/components/tour/tour_events.js";

const test_state = vi.hoisted(() => ({
    filters_context: null,
    is_mobile: false,
    local_storage: new Map(),
    set_spot_buffering: vi.fn(),
    show_left_menu: false,
}));

vi.mock("@uidotdev/usehooks", async () => {
    const React = await vi.importActual("react");

    return {
        useLocalStorage: (key, initial_value) => {
            const [value, set_value] = React.useState(() =>
                test_state.local_storage.has(key)
                    ? test_state.local_storage.get(key)
                    : initial_value,
            );
            const set_stored_value = value_or_setter => {
                set_value(current_value => {
                    const next_value =
                        typeof value_or_setter === "function"
                            ? value_or_setter(current_value)
                            : value_or_setter;
                    test_state.local_storage.set(key, next_value);
                    return next_value;
                });
            };

            return [value, set_stored_value];
        },
        useMediaQuery: () => test_state.is_mobile,
    };
});

vi.mock("react-joyride", async () => {
    const React = await vi.importActual("react");
    const ACTIONS = { CLOSE: "close", NEXT: "next", PREV: "prev" };
    const EVENTS = { STEP_AFTER: "step:after", TARGET_NOT_FOUND: "target:not_found" };
    const STATUS = { FINISHED: "finished", SKIPPED: "skipped" };

    function Joyride({ onEvent, run, stepIndex, steps }) {
        if (!run) return null;

        const step = steps[stepIndex];
        const buttons = step?.buttons ?? ["back", "close", "primary"];
        return (
            <div
                data-testid="joyride-step"
                data-step-has-width={Object.hasOwn(step, "width")}
                data-step-target={step?.target}
                data-step-width={step?.width}
            >
                <h2>{step?.title}</h2>
                <p>{step?.content}</p>
                <div data-testid="joyride-buttons">{buttons.join(",")}</div>
                {buttons.includes("back") ? (
                    <button
                        type="button"
                        onClick={() =>
                            onEvent({
                                action: ACTIONS.PREV,
                                index: stepIndex,
                                status: "running",
                                type: EVENTS.STEP_AFTER,
                            })
                        }
                    >
                        Joyride back
                    </button>
                ) : null}
                {buttons.includes("primary") ? (
                    <button
                        type="button"
                        onClick={() =>
                            onEvent({
                                action: ACTIONS.NEXT,
                                index: stepIndex,
                                status: "running",
                                type: EVENTS.STEP_AFTER,
                            })
                        }
                    >
                        Joyride next
                    </button>
                ) : null}
            </div>
        );
    }

    return { ACTIONS, EVENTS, Joyride, STATUS };
});

vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({
        colors: {
            theme: {
                background: "#000000",
                borders: "#333333",
                input_background: "#111111",
                text: "#ffffff",
            },
        },
    }),
}));

vi.mock("@/hooks/useFilters", () => ({
    useFilters: () => test_state.filters_context,
}));

vi.mock("@/hooks/useRadio", () => ({
    default: () => ({ radio_status: "unavailable" }),
}));

vi.mock("@/hooks/useRestData", () => ({
    useRestData: () => ({ propagation: null }),
}));

vi.mock("@/hooks/useSpotData", () => ({
    useSpotData: () => ({
        spots: test_state.filters_context?.filters.show_only_latest_spot
            ? [{ id: 1 }]
            : [{ id: 1 }, { id: 2 }],
        set_spot_buffering: test_state.set_spot_buffering,
    }),
}));

function TestHarness() {
    const [filters, set_filters] = useState({
        radio_band: false,
        show_only_latest_spot: false,
    });
    const [show_settings, set_show_settings] = useState(false);
    const [show_map_controls_panel, set_show_map_controls_panel] = useState(false);
    const [map_theme, set_map_theme] = useState("colorful");
    const [map_projection, set_map_projection] = useState("globe");
    const [map_night, set_map_night] = useState("off");
    const [map_equator, set_map_equator] = useState("off");
    const [zone_overlay, set_zone_overlay] = useState("none");
    const [regional_overlay, set_regional_overlay] = useState("none");
    const [show_side_panel, set_show_side_panel] = useState(true);
    const [band_filter_state, set_band_filter_state] = useState("off");
    const [show_band_options, set_show_band_options] = useState(false);
    const [mode_filter_state, set_mode_filter_state] = useState("on");
    const [show_filter_modal, set_show_filter_modal] = useState(false);
    const [callsign_filters, set_callsign_filters] = useState({
        filters: [],
        is_alert_filters_active: true,
        is_hide_filters_active: true,
        is_show_only_filters_active: true,
    });
    const [table_sort_state, set_table_sort_state] = useState("inactive");
    const [spot_row_state, set_spot_row_state] = useState("unpinned");
    const [table_context_menu, set_table_context_menu] = useState({
        visible: false,
        menu_type: null,
    });
    const setFilters = value_or_setter => {
        set_filters(current_filters =>
            typeof value_or_setter === "function"
                ? value_or_setter(current_filters)
                : value_or_setter,
        );
    };
    const setCallsignFilters = value_or_setter => {
        set_callsign_filters(current_filters =>
            typeof value_or_setter === "function"
                ? value_or_setter(current_filters)
                : value_or_setter,
        );
    };
    const alert_filter_count = callsign_filters.filters.filter(
        filter => filter.action === "alert",
    ).length;
    const show_only_filter_count = callsign_filters.filters.filter(
        filter => filter.action === "show_only",
    ).length;
    test_state.filters_context = { filters, setFilters, callsign_filters, setCallsignFilters };

    useEffect(() => {
        function close_map_controls_panel() {
            set_show_map_controls_panel(false);
        }

        document.addEventListener(TOUR_CLOSE_MAP_CONTROLS_EVENT, close_map_controls_panel);
        return () => {
            document.removeEventListener(TOUR_CLOSE_MAP_CONTROLS_EVENT, close_map_controls_panel);
        };
    }, []);

    useEffect(() => {
        function handle_filter_options(event) {
            const detail = event.detail ?? {};
            const is_band_20 = detail.filter_key === "bands" && detail.filter_value === 20;
            if (detail.open && is_band_20) {
                set_show_band_options(true);
            } else if (!detail.open) {
                set_show_band_options(false);
            }
        }

        document.addEventListener(TOUR_FILTER_OPTIONS_EVENT, handle_filter_options);
        return () => {
            document.removeEventListener(TOUR_FILTER_OPTIONS_EVENT, handle_filter_options);
        };
    }, []);

    useEffect(() => {
        function close_modal() {
            set_show_filter_modal(false);
            set_show_settings(false);
        }

        document.addEventListener(TOUR_CLOSE_MODAL_EVENT, close_modal);
        return () => document.removeEventListener(TOUR_CLOSE_MODAL_EVENT, close_modal);
    }, []);

    useEffect(() => {
        function close_side_panel() {
            set_show_side_panel(false);
        }

        document.addEventListener(TOUR_CLOSE_SIDE_PANEL_EVENT, close_side_panel);
        return () => document.removeEventListener(TOUR_CLOSE_SIDE_PANEL_EVENT, close_side_panel);
    }, []);

    useEffect(() => {
        function handle_table_context_menu(event) {
            const detail = event.detail ?? {};
            if (detail.open === false) {
                set_table_context_menu({ visible: false, menu_type: null });
                return;
            }

            if (detail.open === true) {
                set_table_context_menu({ visible: true, menu_type: detail.menu_type });
            }
        }

        document.addEventListener(TOUR_TABLE_CONTEXT_MENU_EVENT, handle_table_context_menu);
        return () => {
            document.removeEventListener(TOUR_TABLE_CONTEXT_MENU_EVENT, handle_table_context_menu);
        };
    }, []);

    useEffect(() => {
        function handle_table_spot_row(event) {
            const detail = event.detail ?? {};
            if (detail.pinned === false) {
                set_spot_row_state("unpinned");
            }
        }

        document.addEventListener(TOUR_TABLE_SPOT_ROW_EVENT, handle_table_spot_row);
        return () => {
            document.removeEventListener(TOUR_TABLE_SPOT_ROW_EVENT, handle_table_spot_row);
        };
    }, []);

    function open_table_context_menu(event, menu_type) {
        event.preventDefault();
        set_table_context_menu({ visible: true, menu_type });
    }

    function move_last_filter(from_action, to_action) {
        setCallsignFilters(current_filters => {
            const filter_index = (() => {
                for (let index = current_filters.filters.length - 1; index >= 0; index -= 1) {
                    if (current_filters.filters[index]?.action === from_action) return index;
                }

                return -1;
            })();
            if (filter_index < 0) return current_filters;

            const next_filters = [...current_filters.filters];
            next_filters[filter_index] = { ...next_filters[filter_index], action: to_action };
            return { ...current_filters, filters: next_filters };
        });
    }

    return (
        <>
            <WebsiteTour />
            <div data-tour="mobile-main-tabs">
                <button type="button">Map</button>
                <button type="button" data-tour="mobile-main-tab-table">
                    Table
                </button>
            </div>
            <div data-tour="map-panel">Map</div>
            <div data-tour="map-controls">Map controls</div>
            <button type="button" data-tour="map-reset">
                Reset map
            </button>
            <button type="button" data-tour="map-fullscreen">
                Fullscreen map
            </button>
            <button
                type="button"
                data-tour="map-controls-toggle"
                onClick={() => set_show_map_controls_panel(true)}
            >
                Show map controls
            </button>
            {show_map_controls_panel ? (
                <div data-tour="map-controls-panel">
                    <div data-tour="map-theme-buttons" data-tour-state={map_theme}>
                        <button type="button" onClick={() => set_map_theme("colorful")}>
                            Use colorful map theme
                        </button>
                        <button type="button" onClick={() => set_map_theme("earth")}>
                            Use earth map theme
                        </button>
                    </div>
                    <button
                        type="button"
                        data-tour="map-projection-toggle"
                        data-tour-state={map_projection}
                        onClick={() =>
                            set_map_projection(current =>
                                current === "globe" ? "azimuthal" : "globe",
                            )
                        }
                    >
                        Projection
                    </button>
                    <button
                        type="button"
                        data-tour="map-night-toggle"
                        data-tour-state={map_night}
                        onClick={() => set_map_night(current => (current === "off" ? "on" : "off"))}
                    >
                        Night
                    </button>
                    <button
                        type="button"
                        data-tour="map-equator-toggle"
                        data-tour-state={map_equator}
                        onClick={() =>
                            set_map_equator(current => (current === "off" ? "on" : "off"))
                        }
                    >
                        Equator
                    </button>
                    <div data-tour="map-overlays" data-tour-state={zone_overlay}>
                        <button
                            type="button"
                            data-tour="map-overlay-dxcc"
                            data-tour-state={zone_overlay === "dxcc" ? "on" : "off"}
                            onClick={() =>
                                set_zone_overlay(current => (current === "dxcc" ? "none" : "dxcc"))
                            }
                        >
                            DXCC
                        </button>
                        <button
                            type="button"
                            onClick={() =>
                                set_zone_overlay(current => (current === "cq" ? "none" : "cq"))
                            }
                        >
                            CQ
                        </button>
                    </div>
                    <div data-tour="map-region-overlays" data-tour-state={regional_overlay}>
                        <button
                            type="button"
                            data-tour="map-region-overlay-us_state"
                            data-tour-state={regional_overlay === "us_state" ? "on" : "off"}
                            onClick={() =>
                                set_regional_overlay(current =>
                                    current === "us_state" ? "none" : "us_state",
                                )
                            }
                        >
                            US state
                        </button>
                        <button
                            type="button"
                            onClick={() =>
                                set_regional_overlay(current =>
                                    current === "canadian_province" ? "none" : "canadian_province",
                                )
                            }
                        >
                            Canadian province
                        </button>
                    </div>
                </div>
            ) : null}
            <button
                type="button"
                data-tour="top-bar-settings"
                onClick={() => set_show_settings(true)}
            >
                Open settings
            </button>
            {test_state.show_left_menu ? (
                <button type="button" data-tour="top-bar-left-menu">
                    Open filter rail
                </button>
            ) : null}
            {show_settings ? (
                <div data-tour="settings-modal">
                    <div data-tour="settings-modal-content">
                        <button
                            type="button"
                            data-tour="modal-close-button"
                            onClick={() => set_show_settings(false)}
                        >
                            Close settings
                        </button>
                        <div data-tour="settings-tabs">
                            <button
                                type="button"
                                data-tour="settings-tab-bands-modes"
                                data-tour-state="inactive"
                            >
                                Bands & Modes
                            </button>
                            <button
                                type="button"
                                data-tour="settings-tab-import-export"
                                data-tour-state="inactive"
                            >
                                Import/Export
                            </button>
                        </div>
                        <div data-tour="settings-general">General settings content</div>
                        <div data-tour="settings-callsign">Callsign setting</div>
                        <div data-tour="settings-locator">Locator setting</div>
                        <div data-tour="settings-default-radius">Default radius setting</div>
                        <div data-tour="settings-theme">Theme setting</div>
                        <div data-tour="settings-distance-units">Distance units setting</div>
                        <button type="button" data-tour="modal-cancel-button">
                            Cancel
                        </button>
                    </div>
                </div>
            ) : null}
            <div data-tour="left-column">Left filters</div>
            <button
                type="button"
                data-tour="band-filter-20"
                data-tour-state={band_filter_state}
                onClick={() => set_band_filter_state(current => (current === "on" ? "off" : "on"))}
            >
                20m
            </button>
            <div
                data-tour="filter-options-trigger-bands-20"
                onMouseEnter={() => set_show_band_options(true)}
                onMouseLeave={() => set_show_band_options(false)}
            >
                Band options trigger
            </div>
            {show_band_options ? (
                <div data-tour="filter-options-popup" data-tour-state="bands-20">
                    ONLY and ALL popup
                </div>
            ) : null}
            <button
                type="button"
                data-tour="mode-filter-SSB"
                data-tour-state={mode_filter_state}
                onClick={() => set_mode_filter_state(current => (current === "on" ? "off" : "on"))}
            >
                SSB
            </button>
            <div data-tour="spots-table">Spots table</div>
            <input aria-label="Mobile callsign search" data-tour="table-search-mobile" />
            <button
                type="button"
                data-tour="table-search-single-spot-toggle"
                data-tour-state={filters.show_only_latest_spot ? "on" : "off"}
                onClick={() =>
                    setFilters(current_filters => ({
                        ...current_filters,
                        show_only_latest_spot: !current_filters.show_only_latest_spot,
                    }))
                }
            >
                Single spot per station
            </button>
            <button
                type="button"
                data-tour="table-header-dx_callsign"
                data-tour-state={table_sort_state}
                onClick={() => set_table_sort_state("active")}
            >
                DX
            </button>
            <div
                data-tour="spot-row"
                data-tour-state={spot_row_state}
                onClick={() => set_spot_row_state("pinned")}
            >
                <span>Spot row</span>
                <button
                    type="button"
                    data-tour="spot-row-dx-callsign"
                    onContextMenu={event => open_table_context_menu(event, "callsign")}
                >
                    DX callsign
                </button>
                <button
                    type="button"
                    data-tour="spot-row-flag"
                    onContextMenu={event => open_table_context_menu(event, "flag")}
                >
                    Flag
                </button>
                <button type="button" data-tour="spot-row-frequency">
                    Frequency cell
                </button>
            </div>
            {table_context_menu.visible ? (
                <div data-tour="table-context-menu" data-tour-state={table_context_menu.menu_type}>
                    Table {table_context_menu.menu_type} menu
                </div>
            ) : null}
            <button
                type="button"
                data-tour="top-bar-right-menu"
                onClick={() => set_show_side_panel(current => !current)}
            >
                Toggle side panel
            </button>
            {show_side_panel ? (
                <div data-tour="side-panel">
                    <div data-tour="side-panel-tabs">
                        <button
                            type="button"
                            data-tour="side-panel-tab-filters"
                            data-tour-state="active"
                        >
                            Filters
                        </button>
                    </div>
                    <div data-tour="side-panel-view-filters">
                        <div data-tour="filters-panel">
                            <div
                                data-tour="filter-section-alert"
                                data-tour-state={alert_filter_count}
                            >
                                <button
                                    type="button"
                                    data-tour="add-filter-button-alert"
                                    onClick={() => set_show_filter_modal(true)}
                                >
                                    Add
                                </button>
                                {alert_filter_count > 0 ? (
                                    <div
                                        data-tour="filter-line-alert"
                                        onClick={() => move_last_filter("alert", "show_only")}
                                    >
                                        Alert filter
                                    </div>
                                ) : null}
                            </div>
                            <div
                                data-tour="filter-section-show_only"
                                data-tour-state={show_only_filter_count}
                            >
                                <button type="button">Add</button>
                                {show_only_filter_count > 0 ? (
                                    <div data-tour="filter-line-show_only">Show-only filter</div>
                                ) : null}
                            </div>
                            <div data-tour="filter-section-hide" data-tour-state="0">
                                <button type="button">Add</button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
            {show_filter_modal ? (
                <div data-tour="filter-modal">
                    <div data-tour="filter-modal-content">
                        <button type="button" data-tour="filter-modal-action-alert">
                            Alert
                        </button>
                        <button type="button" data-tour="filter-modal-type-prefix">
                            Prefix
                        </button>
                        <button type="button" data-tour="filter-modal-spot-role-dx">
                            DX
                        </button>
                        <label>
                            Filter value
                            <input data-tour="filter-modal-text-value" />
                        </label>
                        <span>Filter modal content</span>
                        <button
                            type="button"
                            data-tour="modal-apply-button"
                            onClick={() => {
                                setCallsignFilters(current_filters => ({
                                    ...current_filters,
                                    filters: [
                                        ...current_filters.filters,
                                        {
                                            action: "alert",
                                            type: "prefix",
                                            value: "K",
                                            spotter_or_dx: "dx",
                                        },
                                    ],
                                }));
                                set_show_filter_modal(false);
                            }}
                        >
                            Apply
                        </button>
                    </div>
                </div>
            ) : null}
        </>
    );
}

async function start_tour(user, chapter_title) {
    await user.click(screen.getByRole("button", { name: "Show tour launcher" }));
    await user.click(screen.getByRole("button", { name: `Select ${chapter_title} tour` }));
    await user.click(screen.getByRole("button", { name: "Start tour" }));
}

async function open_map_tour_display_panel(user) {
    await start_tour(user, "Map");
    await user.click(screen.getByRole("button", { name: "Joyride next" }));
    await user.click(screen.getByRole("button", { name: "Joyride next" }));
    await user.click(screen.getByRole("button", { name: "Joyride next" }));
    await user.click(screen.getByRole("button", { name: "Joyride next" }));
    await user.click(screen.getByRole("button", { name: "Show map controls" }));

    await waitFor(() => {
        expect(screen.getByText("Display Panel")).not.toBeNull();
    });
}

function close_table_context_menu() {
    document.dispatchEvent(
        new CustomEvent(TOUR_TABLE_CONTEXT_MENU_EVENT, { detail: { open: false } }),
    );
}

async function open_table_tour_callsign_prompt(user) {
    await start_tour(user, "Spots Table");

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Single Spot Mode" })).not.toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "Single spot per station" }));

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Columns And Sorting" })).not.toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "DX" }));

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Spot Row" })).not.toBeNull();
    });
    await user.click(screen.getByText("Spot row"));

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Right-Click A Callsign" })).not.toBeNull();
    });
}

async function open_table_tour_callsign_actions(user) {
    await open_table_tour_callsign_prompt(user);
    fireEvent.contextMenu(screen.getByRole("button", { name: "DX callsign" }));

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Callsign Actions" })).not.toBeNull();
    });
}

async function open_table_tour_flag_prompt(user) {
    await open_table_tour_callsign_actions(user);
    close_table_context_menu();

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Right-Click A Flag" })).not.toBeNull();
    });
}

async function open_table_tour_entity_actions(user) {
    await open_table_tour_flag_prompt(user);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Flag" }));

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Entity Actions" })).not.toBeNull();
    });
}

async function open_filter_tour_filter_editor(user) {
    await start_tour(user, "Filters");

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Quick Filters" })).not.toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "Joyride next" }));

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Band Filters" })).not.toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "20m" }));

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Open Band Options" })).not.toBeNull();
    });
    fireEvent.mouseEnter(screen.getByText("Band options trigger"));

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "ONLY And ALL" })).not.toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "Joyride next" }));

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Mode Filters" })).not.toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "SSB" }));

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Filters Tab" })).not.toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "Joyride next" }));

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Advanced Filters" })).not.toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "Joyride next" }));

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Alert Filters" })).not.toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "Joyride next" }));

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Show-Only Filters" })).not.toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "Joyride next" }));

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Hide Filters" })).not.toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "Joyride next" }));

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Create A Filter" })).not.toBeNull();
    });
    await user.click(screen.getAllByRole("button", { name: "Add" })[0]);

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Filter Editor" })).not.toBeNull();
    });
}

async function open_filter_tour_drag_prompt(user) {
    await open_filter_tour_filter_editor(user);

    await user.click(screen.getByRole("button", { name: "Joyride next" }));
    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Filter Action" })).not.toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "Joyride next" }));
    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Filter Type" })).not.toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "Joyride next" }));
    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "DX Or Spotter" })).not.toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "Joyride next" }));
    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Type A Value" })).not.toBeNull();
    });
    await user.click(screen.getByRole("button", { name: "Joyride next" }));
    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Add A Filter" })).not.toBeNull();
    });
    fireEvent.change(screen.getByLabelText("Filter value"), { target: { value: "K" } });
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Drag The New Filter" })).not.toBeNull();
    });
}

describe("WebsiteTour", () => {
    let get_client_rects;

    beforeEach(() => {
        test_state.local_storage.set("first_launch", false);
        get_client_rects = HTMLElement.prototype.getClientRects;
        HTMLElement.prototype.getClientRects = () => [
            { bottom: 1, height: 1, left: 0, right: 1, top: 0, width: 1 },
        ];
    });

    afterEach(() => {
        HTMLElement.prototype.getClientRects = get_client_rects;
        test_state.filters_context = null;
        test_state.is_mobile = false;
        test_state.local_storage.clear();
        test_state.set_spot_buffering.mockClear();
        test_state.show_left_menu = false;
        cleanup();
        vi.restoreAllMocks();
    });

    it("starts the quick tour on first launch", async () => {
        test_state.local_storage.set("first_launch", true);
        render(<TestHarness />);

        await waitFor(() => {
            expect(screen.getByText("Welcome")).not.toBeNull();
        });
        expect(test_state.local_storage.get("first_launch")).toBe(false);
    });

    it("closes both columns when every chapter starts on mobile", async () => {
        test_state.is_mobile = true;
        const close_left_panel = vi.fn();
        const close_side_panel = vi.fn();
        document.addEventListener(TOUR_CLOSE_LEFT_PANEL_EVENT, close_left_panel);
        document.addEventListener(TOUR_CLOSE_SIDE_PANEL_EVENT, close_side_panel);

        const chapter_titles = [
            "Quick Start",
            "Map",
            "Spots Table",
            "Filters",
            "Side Panel",
            "Settings",
        ];
        for (const chapter_title of chapter_titles) {
            const user = userEvent.setup();
            const view = render(<TestHarness />);
            await start_tour(user, chapter_title);
            view.unmount();
        }

        expect(close_left_panel).toHaveBeenCalledTimes(chapter_titles.length);
        expect(close_side_panel).toHaveBeenCalledTimes(chapter_titles.length);
        document.removeEventListener(TOUR_CLOSE_LEFT_PANEL_EVENT, close_left_panel);
        document.removeEventListener(TOUR_CLOSE_SIDE_PANEL_EVENT, close_side_panel);
    });

    it("advances waitForChange steps after the action re-renders the tour", async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await start_tour(user, "Spots Table");

        if (screen.queryByRole("heading", { name: "Spots Table" })) {
            await user.click(screen.getByRole("button", { name: "Joyride next" }));
        }

        expect(screen.getByText("Single Spot Mode")).not.toBeNull();

        await user.click(screen.getByRole("button", { name: "Single spot per station" }));

        await waitFor(() => {
            expect(screen.getByText("Columns And Sorting")).not.toBeNull();
        });
    });

    it("enables spot buffering while a tour runs", async () => {
        const user = userEvent.setup();
        const { unmount } = render(<TestHarness />);

        await start_tour(user, "Spots Table");

        await waitFor(() => {
            expect(test_state.set_spot_buffering).toHaveBeenCalledWith(true);
        });

        unmount();

        expect(test_state.set_spot_buffering).toHaveBeenLastCalledWith(false);
    });

    it("shows next when a waitForChange tab step is already satisfied", async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await start_tour(user, "Side Panel");

        await user.click(screen.getByRole("button", { name: "Joyride next" }));
        await user.click(screen.getByRole("button", { name: "Joyride next" }));

        await waitFor(() => {
            expect(
                screen.getByText("Click the Filters tab to show the advanced filter builder."),
            ).not.toBeNull();
        });
        expect(screen.getByTestId("joyride-buttons").textContent).toContain("primary");

        await user.click(screen.getByRole("button", { name: "Joyride next" }));

        expect(
            screen.getByText(
                "This view contains advanced alert, show-only, and hide filter sections.",
            ),
        ).not.toBeNull();
    });

    it("returns to the side panel open prompt when backing from the overview", async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await user.click(screen.getByRole("button", { name: "Toggle side panel" }));
        expect(document.querySelector("[data-tour='side-panel']")).toBeNull();

        await start_tour(user, "Side Panel");

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Open The Side Panel" })).not.toBeNull();
        });
        await user.click(screen.getByRole("button", { name: "Toggle side panel" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Side Panel" })).not.toBeNull();
        });
        await user.click(screen.getByRole("button", { name: "Joyride back" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Open The Side Panel" })).not.toBeNull();
        });
        expect(document.querySelector("[data-tour='side-panel']")).toBeNull();

        await user.click(screen.getByRole("button", { name: "Toggle side panel" }));
        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Side Panel" })).not.toBeNull();
        });
    });

    it("keeps settings modal steps after opening the dialog", async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await start_tour(user, "Settings");

        await user.click(screen.getByRole("button", { name: "Open settings" }));

        await waitFor(() => {
            expect(screen.getByText("Settings Dialog")).not.toBeNull();
        });

        await user.click(screen.getByRole("button", { name: "Joyride next" }));
        expect(screen.getByText("General Settings")).not.toBeNull();
    });

    it("returns to the settings open prompt when backing from the dialog", async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await start_tour(user, "Settings");
        await user.click(screen.getByRole("button", { name: "Open settings" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Settings Dialog" })).not.toBeNull();
        });
        await user.click(screen.getByRole("button", { name: "Joyride back" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Open Settings" })).not.toBeNull();
        });
        await waitFor(() => {
            expect(document.querySelector("[data-tour='settings-modal']")).toBeNull();
        });

        await user.click(screen.getByRole("button", { name: "Open settings" }));
        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Settings Dialog" })).not.toBeNull();
        });
    });

    it("does not show back on the first filters step", async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await start_tour(user, "Filters");

        await waitFor(() => {
            expect(screen.getByText("Quick Filters")).not.toBeNull();
        });
        expect(screen.getByTestId("joyride-buttons").textContent).not.toContain("back");
        expect(screen.queryByRole("button", { name: "Joyride back" })).toBeNull();
    });

    it("keeps the filter rail step visible when backing from quick filters on mobile", async () => {
        test_state.is_mobile = true;
        test_state.show_left_menu = true;
        const user = userEvent.setup();
        render(<TestHarness />);

        await start_tour(user, "Filters");

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Open The Filter Rail" })).not.toBeNull();
        });
        await user.click(screen.getByRole("button", { name: "Joyride next" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Quick Filters" })).not.toBeNull();
        });
        await user.click(screen.getByRole("button", { name: "Joyride back" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Open The Filter Rail" })).not.toBeNull();
        });
        expect(screen.getByTestId("joyride-buttons").textContent).toContain("primary");

        await user.click(screen.getByRole("button", { name: "Joyride next" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Quick Filters" })).not.toBeNull();
        });
    });

    it("returns to the band filter when backing from ONLY and ALL", async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await start_tour(user, "Filters");

        await waitFor(() => {
            expect(screen.getByText("Quick Filters")).not.toBeNull();
        });
        await user.click(screen.getByRole("button", { name: "Joyride next" }));

        await waitFor(() => {
            expect(screen.getByText("Band Filters")).not.toBeNull();
        });
        await user.click(screen.getByRole("button", { name: "20m" }));

        await waitFor(() => {
            expect(screen.getByText("Open Band Options")).not.toBeNull();
        });
        fireEvent.mouseEnter(screen.getByText("Band options trigger"));

        await waitFor(() => {
            expect(screen.getByText("ONLY And ALL")).not.toBeNull();
        });

        await user.click(screen.getByRole("button", { name: "Joyride back" }));

        await waitFor(() => {
            expect(screen.getByText("Band Filters")).not.toBeNull();
        });
        await waitFor(() => {
            expect(screen.queryByText("ONLY and ALL popup")).toBeNull();
        });

        fireEvent.mouseEnter(screen.getByText("Band options trigger"));
        expect(screen.getByText("Band Filters")).not.toBeNull();
        fireEvent.mouseLeave(screen.getByText("Band options trigger"));

        await user.click(screen.getByRole("button", { name: "20m" }));

        await waitFor(() => {
            expect(screen.getByText("Open Band Options")).not.toBeNull();
        });
        fireEvent.mouseEnter(screen.getByText("Band options trigger"));

        await waitFor(() => {
            expect(screen.getByText("ONLY And ALL")).not.toBeNull();
        });
    });

    it("closes the filter modal when backing from the filter editor", async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await open_filter_tour_filter_editor(user);
        expect(screen.queryByText("Filter modal content")).not.toBeNull();

        await user.click(screen.getByRole("button", { name: "Joyride back" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Create A Filter" })).not.toBeNull();
        });
        await waitFor(() => {
            expect(screen.queryByText("Filter modal content")).toBeNull();
        });

        await user.click(screen.getAllByRole("button", { name: "Add" })[0]);

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Filter Editor" })).not.toBeNull();
        });
    });

    it("returns to create filter when backing from the drag prompt", async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await open_filter_tour_drag_prompt(user);
        expect(screen.queryByText("Alert filter")).not.toBeNull();

        await user.click(screen.getByRole("button", { name: "Joyride back" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Create A Filter" })).not.toBeNull();
        });
        expect(screen.queryByText("Alert filter")).toBeNull();
    });

    it("restores the alert filter when backing from filter moved", async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await open_filter_tour_drag_prompt(user);
        await user.click(screen.getByText("Alert filter"));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Filter Moved" })).not.toBeNull();
        });
        expect(screen.queryByText("Show-only filter")).not.toBeNull();

        await user.click(screen.getByRole("button", { name: "Joyride back" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Drag The New Filter" })).not.toBeNull();
        });
        expect(screen.queryByText("Alert filter")).not.toBeNull();
        expect(screen.queryByText("Show-only filter")).toBeNull();

        await user.click(screen.getByText("Alert filter"));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Filter Moved" })).not.toBeNull();
        });
    });

    it("closes map controls when backing from the display panel", async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await open_map_tour_display_panel(user);

        expect(screen.queryByText("Projection")).not.toBeNull();

        await user.click(screen.getByRole("button", { name: "Joyride back" }));

        await waitFor(() => {
            expect(screen.queryByText("Projection")).toBeNull();
        });
        expect(screen.getByText("Open Map Controls")).not.toBeNull();
    });

    it("starts the mobile map tour on the show map step when the map is already visible", async () => {
        test_state.is_mobile = true;
        const user = userEvent.setup();
        render(<TestHarness />);

        await start_tour(user, "Map");

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Show The Map" })).not.toBeNull();
        });
        expect(screen.getByTestId("joyride-buttons").textContent).toContain("primary");
        expect(screen.getByTestId("joyride-buttons").textContent).not.toContain("back");

        await user.click(screen.getByRole("button", { name: "Joyride next" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Map Controls" })).not.toBeNull();
        });
    });

    it("keeps the show table step visible when backing from mobile callsign search", async () => {
        test_state.is_mobile = true;
        const user = userEvent.setup();
        render(<TestHarness />);

        await start_tour(user, "Spots Table");

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Show The Table" })).not.toBeNull();
        });
        expect(screen.getByTestId("joyride-step").dataset.stepTarget).toBe(
            "[data-tour='mobile-main-tab-table']",
        );
        await user.click(screen.getByRole("button", { name: "Joyride next" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Callsign Search" })).not.toBeNull();
        });
        await user.click(screen.getByRole("button", { name: "Joyride back" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Show The Table" })).not.toBeNull();
        });
        expect(screen.getByTestId("joyride-buttons").textContent).toContain("primary");

        await user.click(screen.getByRole("button", { name: "Joyride next" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Callsign Search" })).not.toBeNull();
        });
    });

    it("keeps the open filter rail step visible when backing on mobile", async () => {
        test_state.is_mobile = true;
        test_state.show_left_menu = true;
        const user = userEvent.setup();
        render(<TestHarness />);

        await start_tour(user, "Quick Start");
        expect(screen.getByTestId("joyride-step").dataset.stepHasWidth).toBe("false");
        for (let index = 0; index < 4; index += 1) {
            await user.click(screen.getByRole("button", { name: "Joyride next" }));
        }

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Open The Filter Rail" })).not.toBeNull();
        });
        await user.click(screen.getByRole("button", { name: "Joyride next" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Band And Mode Filters" })).not.toBeNull();
        });
        expect(screen.getByTestId("joyride-step").dataset.stepWidth).toBe("320");
        await user.click(screen.getByRole("button", { name: "Joyride back" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Open The Filter Rail" })).not.toBeNull();
        });
        expect(screen.getByTestId("joyride-buttons").textContent).toContain("primary");

        await user.click(screen.getByRole("button", { name: "Joyride next" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Band And Mode Filters" })).not.toBeNull();
        });
    });

    it("requires a theme change after the first display controls", async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await open_map_tour_display_panel(user);
        await user.click(screen.getByRole("button", { name: "Joyride next" }));
        await user.click(screen.getByRole("button", { name: "Night" }));
        await user.click(screen.getByRole("button", { name: "Projection" }));
        await user.click(screen.getByRole("button", { name: "Equator" }));

        expect(screen.getByRole("heading", { name: "Map Themes" })).not.toBeNull();
        expect(screen.queryByRole("button", { name: "Joyride next" })).toBeNull();
        await user.click(screen.getByRole("button", { name: "Use earth map theme" }));
        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Zone overlay" })).not.toBeNull();
        });
        expect(screen.queryByRole("button", { name: "Joyride next" })).toBeNull();
        await user.click(screen.getByRole("button", { name: "CQ" }));
        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Regional Overlay" })).not.toBeNull();
        });
        expect(screen.queryByRole("button", { name: "Joyride next" })).toBeNull();
        await user.click(screen.getByRole("button", { name: "Joyride back" }));
        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Zone overlay" })).not.toBeNull();
        });
        await user.click(screen.getByRole("button", { name: "DXCC" }));
        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Regional Overlay" })).not.toBeNull();
        });
        await user.click(screen.getByRole("button", { name: "Canadian province" }));
        await waitFor(() => {
            expect(screen.queryByTestId("joyride-step")).toBeNull();
        });
    });

    it("keeps map controls open when backing from night overlay", async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await open_map_tour_display_panel(user);
        await user.click(screen.getByRole("button", { name: "Joyride next" }));

        await waitFor(() => {
            expect(screen.getByText("Try Night Overlay")).not.toBeNull();
        });

        await user.click(screen.getByRole("button", { name: "Joyride back" }));

        await waitFor(() => {
            expect(screen.getByText("Display Panel")).not.toBeNull();
        });
        expect(screen.queryByText("Projection")).not.toBeNull();
    });

    it("unpins the spot row when backing from the callsign prompt", async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await open_table_tour_callsign_prompt(user);

        expect(
            screen
                .getByText("Spot row")
                .closest("[data-tour='spot-row']")
                ?.getAttribute("data-tour-state"),
        ).toBe("pinned");

        await user.click(screen.getByRole("button", { name: "Joyride back" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Spot Row" })).not.toBeNull();
        });
        expect(
            screen
                .getByText("Spot row")
                .closest("[data-tour='spot-row']")
                ?.getAttribute("data-tour-state"),
        ).toBe("unpinned");

        await user.click(screen.getByText("Spot row"));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Right-Click A Callsign" })).not.toBeNull();
        });
    });

    it("handles callsign context menu back transitions", async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await open_table_tour_callsign_actions(user);
        expect(screen.queryByText("Table callsign menu")).not.toBeNull();

        await user.click(screen.getByRole("button", { name: "Joyride back" }));

        await waitFor(() => {
            expect(screen.queryByText("Table callsign menu")).toBeNull();
        });
        expect(screen.getByRole("heading", { name: "Right-Click A Callsign" })).not.toBeNull();

        fireEvent.contextMenu(screen.getByRole("button", { name: "DX callsign" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Callsign Actions" })).not.toBeNull();
        });
        close_table_context_menu();

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Right-Click A Flag" })).not.toBeNull();
        });

        await user.click(screen.getByRole("button", { name: "Joyride back" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Callsign Actions" })).not.toBeNull();
        });
        expect(screen.queryByText("Table callsign menu")).not.toBeNull();
    });

    it("handles flag context menu back transitions", async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await open_table_tour_entity_actions(user);
        expect(screen.queryByText("Table flag menu")).not.toBeNull();

        await user.click(screen.getByRole("button", { name: "Joyride back" }));

        await waitFor(() => {
            expect(screen.queryByText("Table flag menu")).toBeNull();
        });
        expect(screen.getByRole("heading", { name: "Right-Click A Flag" })).not.toBeNull();

        fireEvent.contextMenu(screen.getByRole("button", { name: "Flag" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Entity Actions" })).not.toBeNull();
        });
        close_table_context_menu();

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Frequency" })).not.toBeNull();
        });

        await user.click(screen.getByRole("button", { name: "Joyride back" }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Entity Actions" })).not.toBeNull();
        });
        expect(screen.queryByText("Table flag menu")).not.toBeNull();
    });
});

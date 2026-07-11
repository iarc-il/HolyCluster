import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WebsiteTour from "@/components/tour/WebsiteTour.jsx";
import {
    TOUR_CLOSE_MAP_CONTROLS_EVENT,
    TOUR_TABLE_CONTEXT_MENU_EVENT,
    TOUR_TABLE_SPOT_ROW_EVENT,
} from "@/components/tour/tour_events.js";

const test_state = vi.hoisted(() => ({
    filters_context: null,
    local_storage: new Map(),
    set_spot_buffering: vi.fn(),
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
        useMediaQuery: () => false,
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
            <div data-testid="joyride-step">
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
    test_state.filters_context = { filters, setFilters };

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

    return (
        <>
            <WebsiteTour />
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
                    <button type="button" data-tour="map-projection-toggle" data-tour-state="globe">
                        Projection
                    </button>
                    <button type="button" data-tour="map-night-toggle" data-tour-state="off">
                        Night
                    </button>
                    <button type="button" data-tour="map-equator-toggle" data-tour-state="off">
                        Equator
                    </button>
                    <button type="button" data-tour="map-overlay-dxcc" data-tour-state="off">
                        DXCC
                    </button>
                    <button
                        type="button"
                        data-tour="map-region-overlay-us_state"
                        data-tour-state="off"
                    >
                        US state
                    </button>
                </div>
            ) : null}
            <button
                type="button"
                data-tour="top-bar-settings"
                onClick={() => set_show_settings(true)}
            >
                Open settings
            </button>
            {show_settings ? (
                <div data-tour="settings-modal">
                    <div data-tour="settings-modal-content">
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
            <div data-tour="spots-table">Spots table</div>
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
                <div data-tour="side-panel-view-filters">Advanced filters</div>
            </div>
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
        test_state.local_storage.clear();
        test_state.set_spot_buffering.mockClear();
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

    it("keeps map controls open when backing from projection", async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await open_map_tour_display_panel(user);
        await user.click(screen.getByRole("button", { name: "Joyride next" }));

        await waitFor(() => {
            expect(screen.getByText("Try Projection")).not.toBeNull();
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

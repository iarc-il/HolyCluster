import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WebsiteTour from "@/components/tour/WebsiteTour.jsx";

const test_state = vi.hoisted(() => ({
    filters_context: null,
    set_spot_buffering: vi.fn(),
}));

vi.mock("@uidotdev/usehooks", async () => {
    const React = await vi.importActual("react");

    return {
        useLocalStorage: (_key, initial_value) => React.useState(initial_value),
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
        const buttons = step?.buttons ?? ["primary"];
        return (
            <div data-testid="joyride-step">
                <h2>{step?.title}</h2>
                <p>{step?.content}</p>
                <div data-testid="joyride-buttons">{buttons.join(",")}</div>
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
    const setFilters = value_or_setter => {
        set_filters(current_filters =>
            typeof value_or_setter === "function"
                ? value_or_setter(current_filters)
                : value_or_setter,
        );
    };
    test_state.filters_context = { filters, setFilters };

    return (
        <>
            <WebsiteTour />
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
            <button type="button" data-tour="table-header-dx_callsign" data-tour-state="inactive">
                DX
            </button>
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

describe("WebsiteTour", () => {
    let get_client_rects;

    beforeEach(() => {
        get_client_rects = HTMLElement.prototype.getClientRects;
        HTMLElement.prototype.getClientRects = () => [
            { bottom: 1, height: 1, left: 0, right: 1, top: 0, width: 1 },
        ];
    });

    afterEach(() => {
        HTMLElement.prototype.getClientRects = get_client_rects;
        test_state.filters_context = null;
        test_state.set_spot_buffering.mockClear();
        cleanup();
        vi.restoreAllMocks();
    });

    it("advances waitForChange steps after the action re-renders the tour", async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await user.selectOptions(screen.getByLabelText("Tour chapter"), "spots_table");
        await user.click(screen.getByRole("button", { name: "Tour" }));

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

        await user.selectOptions(screen.getByLabelText("Tour chapter"), "spots_table");
        await user.click(screen.getByRole("button", { name: "Tour" }));

        await waitFor(() => {
            expect(test_state.set_spot_buffering).toHaveBeenCalledWith(true);
        });

        unmount();

        expect(test_state.set_spot_buffering).toHaveBeenLastCalledWith(false);
    });

    it("shows next when a waitForChange tab step is already satisfied", async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await user.selectOptions(screen.getByLabelText("Tour chapter"), "side_panel");
        await user.click(screen.getByRole("button", { name: "Tour" }));

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

        await user.selectOptions(screen.getByLabelText("Tour chapter"), "settings");
        await user.click(screen.getByRole("button", { name: "Tour" }));

        await user.click(screen.getByRole("button", { name: "Open settings" }));

        await waitFor(() => {
            expect(screen.getByText("Settings Dialog")).not.toBeNull();
        });

        await user.click(screen.getByRole("button", { name: "Joyride next" }));
        expect(screen.getByText("General Settings")).not.toBeNull();
    });
});

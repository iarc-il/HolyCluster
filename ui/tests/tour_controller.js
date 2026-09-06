import { describe, expect, it } from "vitest";

import {
    apply_backward_filter_state_update,
    as_array,
    find_available_step_index,
    get_available_steps,
    get_backward_step_side_effect,
    get_step_wait_key,
    get_tour_transition,
    requirements_are_met,
    step_is_excluded,
} from "@/components/tour/tour_controller.js";
import {
    TOUR_CLOSE_MAP_CONTROLS_EVENT,
    TOUR_CLOSE_MODAL_EVENT,
    TOUR_CLOSE_SIDE_PANEL_EVENT,
    TOUR_FILTER_OPTIONS_EVENT,
    TOUR_TABLE_CONTEXT_MENU_EVENT,
    TOUR_TABLE_SPOT_ROW_EVENT,
} from "@/components/tour/tour_events.js";

const target = value => `[data-tour='${value}']`;
const step = (target_name, options = {}) => ({ target: target(target_name), ...options });

function skip_none() {
    return false;
}

describe("tour controller", () => {
    it("normalizes requirements and step lists", () => {
        expect(as_array(null)).toEqual([]);
        expect(as_array("has_spots")).toEqual(["has_spots"]);
        expect(
            requirements_are_met(["has_spots", "radio_available"], {
                has_spots: true,
                radio_available: true,
            }),
        ).toBe(true);
        expect(requirements_are_met(["has_spots", "radio_available"], { has_spots: true })).toBe(
            false,
        );

        const steps = [
            step("desktop", { desktopOnly: true }),
            step("mobile", { mobileOnly: true }),
            step("spots", { requires: "has_spots" }),
            step("always"),
        ];

        expect(
            get_available_steps(steps, {
                is_mobile: true,
                runtime_conditions: { has_spots: false },
            }),
        ).toEqual([steps[1], steps[3]]);
        expect(
            get_available_steps(steps, {
                is_mobile: false,
                runtime_conditions: { has_spots: true },
            }),
        ).toEqual([steps[0], steps[2], steps[3]]);
        expect(
            step_is_excluded(steps[0], {
                is_mobile: true,
                runtime_conditions: {},
            }),
        ).toBe(true);
    });

    it("finds the next or previous non-skipped step", () => {
        const steps = [step("one"), step("two"), step("three"), step("four")];
        const should_skip = candidate => candidate.target === target("two");

        expect(find_available_step_index(steps, 1, 1, should_skip)).toBe(2);
        expect(find_available_step_index(steps, 1, -1, should_skip)).toBe(0);
        expect(find_available_step_index(steps, 4, 1, should_skip)).toBeNull();
        expect(find_available_step_index(steps, -1, -1, should_skip)).toBeNull();
    });

    it("builds stable keys for wait conditions", () => {
        expect(get_step_wait_key("map", 2, step("night"))).toBeNull();
        expect(
            get_step_wait_key(
                "map",
                2,
                step("night", {
                    id: "night_overlay",
                    waitForChange: { selector: target("night"), attribute: "data-tour-state" },
                }),
            ),
        ).toBe(`map:night_overlay:::${target("night")}:data-tour-state`);
        expect(
            get_step_wait_key(
                "filters",
                3,
                step("popup", {
                    waitFor: target("popup"),
                    waitForGone: target("menu"),
                }),
            ).startsWith("filters:3:"),
        ).toBe(true);
    });

    it("returns finish or stay when navigation reaches either end", () => {
        const steps = [step("one"), step("two")];

        expect(
            get_tour_transition({
                chapter_id: "map",
                steps,
                from_index: 1,
                direction: 1,
                should_skip_step: skip_none,
            }),
        ).toEqual({ type: "finish" });
        expect(
            get_tour_transition({
                chapter_id: "map",
                steps,
                from_index: 0,
                direction: -1,
                should_skip_step: skip_none,
            }),
        ).toEqual({ type: "stay" });
    });

    it("skips unavailable steps while moving forward", () => {
        const steps = [step("one"), step("hidden"), step("three")];

        expect(
            get_tour_transition({
                chapter_id: "map",
                steps,
                from_index: 0,
                should_skip_step: candidate => candidate.target === target("hidden"),
            }),
        ).toMatchObject({ type: "step", step_index: 2 });
    });

    it("closes map controls when backing to the open-controls prompt", () => {
        const steps = [
            step("open", { waitFor: target("map-controls-panel") }),
            step("map-controls-panel"),
        ];

        expect(get_backward_step_side_effect("map", steps, 1, 0)).toEqual({
            event: TOUR_CLOSE_MAP_CONTROLS_EVENT,
            wait_needs_reset: true,
        });
    });

    it("closes the side panel when backing to its open prompt", () => {
        const steps = [step("open", { waitFor: target("side-panel") }), step("side-panel")];

        expect(get_backward_step_side_effect("side_panel", steps, 1, 0)).toEqual({
            event: TOUR_CLOSE_SIDE_PANEL_EVENT,
            wait_needs_reset: true,
        });
    });

    it("restores table state while backing through context menus", () => {
        const steps = [
            step("callsign", {
                waitFor: `${target("table-context-menu")}[data-tour-state='callsign']`,
            }),
            step("table-context-menu", { waitForGone: target("table-context-menu") }),
        ];

        expect(get_backward_step_side_effect("spots_table", steps, 0, 1)).toEqual({
            event: TOUR_TABLE_CONTEXT_MENU_EVENT,
            detail: { open: true, target: target("callsign"), menu_type: "callsign" },
            wait_needs_reset: true,
        });

        const close_steps = [
            step("table-context-menu", { waitForGone: target("table-context-menu") }),
            step("callsign", {
                waitFor: `${target("table-context-menu")}[data-tour-state='callsign']`,
            }),
        ];
        expect(get_backward_step_side_effect("spots_table", close_steps, 0, 1)).toEqual({
            event: TOUR_TABLE_CONTEXT_MENU_EVENT,
            detail: { open: false },
            wait_needs_reset: true,
        });
    });

    it("unpins the row when backing to the callsign prompt", () => {
        const steps = [
            step("spot-row", {
                waitForChange: { selector: target("spot-row"), attribute: "data-tour-state" },
            }),
            step("spot-row-dx-callsign"),
        ];

        expect(get_backward_step_side_effect("spots_table", steps, 1, 0)).toEqual({
            event: TOUR_TABLE_SPOT_ROW_EVENT,
            detail: { pinned: false },
            wait_for_change_reset_value: "unpinned",
            wait_needs_reset: true,
        });
    });

    it("closes filters and resets modal state when backing from the editor", () => {
        const steps = [
            step("add-filter-button-alert", { waitFor: target("filter-modal-content") }),
            step("filter-modal-content"),
        ];
        const transition = get_tour_transition({
            chapter_id: "filters",
            steps,
            from_index: 1,
            direction: -1,
            should_skip_step: skip_none,
        });

        expect(transition.step_index).toBe(0);
        expect(transition.side_effect).toEqual({
            event: TOUR_CLOSE_MODAL_EVENT,
            wait_needs_reset: true,
        });
    });

    it("closes the forced filter popup when backing to the hover prompt", () => {
        const steps = [
            step("band", {
                waitForChange: { selector: target("band"), attribute: "data-tour-state" },
            }),
            step("hover", { waitFor: target("filter-options-popup") }),
            step("popup", {
                forceFilterOptions: { filter_key: "bands", filter_value: 20 },
            }),
        ];

        const transition = get_tour_transition({
            chapter_id: "filters",
            steps,
            from_index: 2,
            direction: -1,
            should_skip_step: skip_none,
        });

        expect(transition.step_index).toBe(0);
        expect(transition.side_effect).toEqual({
            event: TOUR_FILTER_OPTIONS_EVENT,
            detail: { filter_key: "bands", filter_value: 20, open: false },
            wait_needs_reset: false,
        });
    });

    it("applies backward filter updates to the last matching filter", () => {
        const filters = {
            filters: [
                { action: "alert", value: "A" },
                { action: "show_only", value: "B" },
                { action: "alert", value: "C" },
            ],
        };

        expect(
            apply_backward_filter_state_update(filters, {
                type: "remove_last_filter",
                action: "alert",
            }),
        ).toEqual({
            filters: [
                { action: "alert", value: "A" },
                { action: "show_only", value: "B" },
            ],
        });
        expect(
            apply_backward_filter_state_update(filters, {
                type: "move_last_filter",
                from_action: "show_only",
                to_action: "alert",
            }),
        ).toEqual({
            filters: [
                { action: "alert", value: "A" },
                { action: "alert", value: "B" },
                { action: "alert", value: "C" },
            ],
        });
    });
});

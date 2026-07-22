import { useFilters } from "@/hooks/useFilters";
import use_radio from "@/hooks/useRadio";
import { useRestData } from "@/hooks/useRestData";
import { useSpotData } from "@/hooks/useSpotData";
import { useLocalStorage, useMediaQuery } from "@uidotdev/usehooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACTIONS, EVENTS, Joyride, STATUS } from "react-joyride";
import TourLauncher from "./TourLauncher.jsx";
import {
    DEFAULT_TOUR_CHAPTER_ID,
    TOUR_COMPLETED_CHAPTERS_KEY,
    get_tour_chapter,
} from "./tour_chapters.jsx";
import {
    TOUR_CLOSE_LEFT_PANEL_EVENT,
    TOUR_CLOSE_MAP_CONTROLS_EVENT,
    TOUR_CLOSE_MODAL_EVENT,
    TOUR_CLOSE_SIDE_PANEL_EVENT,
    TOUR_FILTER_OPTIONS_EVENT,
    TOUR_SELECT_SIDE_PANEL_TAB_EVENT,
    TOUR_TABLE_CONTEXT_MENU_EVENT,
    TOUR_TABLE_SPOT_ROW_EVENT,
} from "./tour_events.js";

const completed_statuses = new Set([STATUS.FINISHED, STATUS.SKIPPED]);
const default_tour_buttons = ["skip", "back", "close", "primary"];
const wait_poll_interval_ms = 150;
const side_panel_selector = "[data-tour='side-panel']";
const map_controls_panel_selector = "[data-tour='map-controls-panel']";
const add_filter_button_alert_selector = "[data-tour='add-filter-button-alert']";
const filter_options_popup_selector = "[data-tour='filter-options-popup']";
const filter_modal_content_selector = "[data-tour='filter-modal-content']";
const settings_modal_content_selector = "[data-tour='settings-modal-content']";
const filter_line_alert_selector = "[data-tour='filter-line-alert']";
const filter_section_show_only_selector = "[data-tour='filter-section-show_only']";
const modal_apply_button_selector = "[data-tour='modal-apply-button']";
const spot_row_selector = "[data-tour='spot-row']";
const spot_row_dx_callsign_selector = "[data-tour='spot-row-dx-callsign']";
const table_context_menu_selector = "[data-tour='table-context-menu']";
const table_context_menu_state_pattern = /\[data-tour-state=['"]([^'"]+)['"]\]/;

function as_array(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
}

function is_element_visible(element) {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;

    return element.getClientRects().length > 0;
}

function is_selector_visible(selector) {
    if (typeof document === "undefined") return false;

    const element = document.querySelector(selector);
    return is_element_visible(element);
}

function are_selectors_visible(selectors) {
    const selector_list = as_array(selectors);
    return selector_list.length > 0 && selector_list.every(is_selector_visible);
}

function are_selectors_gone(selectors) {
    const selector_list = as_array(selectors);
    return (
        selector_list.length > 0 && selector_list.every(selector => !is_selector_visible(selector))
    );
}

function requirements_are_met(requirements, runtime_conditions) {
    return as_array(requirements).every(requirement => runtime_conditions[requirement] === true);
}

function step_wait_is_satisfied(step) {
    if (step.waitFor && are_selectors_visible(step.waitFor)) return true;
    if (step.waitForGone && are_selectors_gone(step.waitForGone)) return true;
    return false;
}

function get_wait_for_change_value(wait_for_change) {
    const target = document.querySelector(wait_for_change.selector);
    if (!is_element_visible(target)) return null;

    if (wait_for_change.attribute) {
        if (
            wait_for_change.attribute === "value" &&
            (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
        ) {
            return target.value;
        }
        return target.getAttribute(wait_for_change.attribute);
    }
    return target.textContent;
}

function get_step_wait_key(chapter_id, step_index, step) {
    if (!step?.waitFor && !step?.waitForGone && !step?.waitForChange) return null;

    const wait_for = as_array(step.waitFor).join("|");
    const wait_for_gone = as_array(step.waitForGone).join("|");
    const wait_for_change = step.waitForChange
        ? `${step.waitForChange.selector}:${step.waitForChange.attribute ?? "text"}`
        : "";
    return `${chapter_id}:${step_index}:${wait_for}:${wait_for_gone}:${wait_for_change}`;
}

function cleanup_chapter(chapter_id) {
    if (typeof document === "undefined") return;

    if (chapter_id === "map") {
        document.dispatchEvent(new Event(TOUR_CLOSE_MAP_CONTROLS_EVENT));
    }

    if (["filters", "settings"].includes(chapter_id)) {
        document.dispatchEvent(new Event(TOUR_CLOSE_MODAL_EVENT));
    }
}

function is_table_context_menu_selector(selector) {
    return typeof selector === "string" && selector.startsWith(table_context_menu_selector);
}

function step_waits_for_table_context_menu(step) {
    return as_array(step?.waitFor).some(is_table_context_menu_selector);
}

function step_waits_for_table_context_menu_gone(step) {
    return as_array(step?.waitForGone).includes(table_context_menu_selector);
}

function get_table_context_menu_type(step) {
    const selector = as_array(step?.waitFor).find(is_table_context_menu_selector);
    return selector?.match(table_context_menu_state_pattern)?.[1] ?? null;
}

function dispatch_tour_side_effect(side_effect) {
    if (typeof document === "undefined" || !side_effect) return;

    document.dispatchEvent(new CustomEvent(side_effect.event, { detail: side_effect.detail }));
}

function find_previous_step_index_by_target(steps, from_index, target) {
    for (let index = from_index; index >= 0; index -= 1) {
        if (steps[index]?.target === target) return index;
    }

    return null;
}

function find_last_filter_index_by_action(callsign_filters, action) {
    const filters = callsign_filters?.filters ?? [];
    for (let index = filters.length - 1; index >= 0; index -= 1) {
        if (filters[index]?.action === action) return index;
    }

    return -1;
}

function remove_last_filter_by_action(callsign_filters, action) {
    const filter_index = find_last_filter_index_by_action(callsign_filters, action);
    if (filter_index < 0) return callsign_filters;

    return {
        ...callsign_filters,
        filters: callsign_filters.filters.filter((_, index) => index !== filter_index),
    };
}

function move_last_filter_action(callsign_filters, from_action, to_action) {
    const filter_index = find_last_filter_index_by_action(callsign_filters, from_action);
    if (filter_index < 0) return callsign_filters;

    const filters = [...callsign_filters.filters];
    filters[filter_index] = { ...filters[filter_index], action: to_action };
    return { ...callsign_filters, filters };
}

function get_backward_step_side_effect(chapter_id, steps, from_index, next_step_index) {
    const current_step = steps[from_index];
    const next_step = steps[next_step_index];
    const backs_to_modal_open_step =
        [filter_modal_content_selector, settings_modal_content_selector].includes(
            current_step?.target,
        ) && as_array(next_step?.waitFor).includes(current_step.target);

    if (
        chapter_id === "map" &&
        current_step?.target === map_controls_panel_selector &&
        as_array(next_step?.waitFor).includes(map_controls_panel_selector)
    ) {
        return { event: TOUR_CLOSE_MAP_CONTROLS_EVENT, wait_needs_reset: true };
    }

    if (as_array(next_step?.waitFor).includes(side_panel_selector)) {
        return { event: TOUR_CLOSE_SIDE_PANEL_EVENT, wait_needs_reset: true };
    }

    const side_panel_back_tabs = {
        "[data-tour='side-panel-tab-band-bar']": {
            next_targets: ["[data-tour='side-panel-view-filters']"],
            label: "Filters",
        },
        "[data-tour='side-panel-tab-heatmap']": {
            next_targets: [
                "[data-tour='band-bar-panel']",
                "[data-tour='band-bar-selector']",
                "[data-tour='band-bar-chart']",
            ],
            label: "Band Bar",
        },
        "[data-tour='side-panel-tab-dxpeditions']": {
            next_targets: [
                "[data-tour='heatmap-panel']",
                "[data-tour='heatmap-continent-selector']",
            ],
            label: "Heatmap",
        },
        "[data-tour='side-panel-tab-missing']": {
            next_targets: ["[data-tour='dxpeditions-sort']"],
            label: "DXpeditions",
        },
    };
    const tab_restore = side_panel_back_tabs[current_step?.target];

    if (chapter_id === "side_panel" && tab_restore?.next_targets.includes(next_step?.target)) {
        return {
            detail: { label: tab_restore.label },
            event: TOUR_SELECT_SIDE_PANEL_TAB_EVENT,
            wait_needs_reset: true,
        };
    }

    if (
        chapter_id === "filters" &&
        current_step?.forceFilterOptions &&
        as_array(next_step?.waitFor).some(selector =>
            selector.startsWith(filter_options_popup_selector),
        )
    ) {
        return {
            detail: { ...current_step.forceFilterOptions, open: false },
            event: TOUR_FILTER_OPTIONS_EVENT,
            wait_needs_reset: false,
        };
    }

    if (["filters", "settings"].includes(chapter_id) && backs_to_modal_open_step) {
        return { event: TOUR_CLOSE_MODAL_EVENT, wait_needs_reset: true };
    }

    if (chapter_id !== "spots_table") return null;

    if (
        current_step?.target === spot_row_dx_callsign_selector &&
        next_step?.waitForChange?.selector === spot_row_selector
    ) {
        return {
            detail: { pinned: false },
            event: TOUR_TABLE_SPOT_ROW_EVENT,
            wait_for_change_reset_value: "unpinned",
            wait_needs_reset: true,
        };
    }

    if (
        current_step?.target === table_context_menu_selector &&
        step_waits_for_table_context_menu_gone(current_step) &&
        step_waits_for_table_context_menu(next_step)
    ) {
        return {
            detail: { open: false },
            event: TOUR_TABLE_CONTEXT_MENU_EVENT,
            wait_needs_reset: true,
        };
    }

    if (
        next_step?.target !== table_context_menu_selector ||
        !step_waits_for_table_context_menu_gone(next_step)
    ) {
        return null;
    }

    const trigger_step = steps[next_step_index - 1];
    const menu_type = get_table_context_menu_type(trigger_step);
    if (!trigger_step?.target || !menu_type) return null;

    return {
        detail: {
            open: true,
            target: trigger_step.target,
            menu_type,
        },
        event: TOUR_TABLE_CONTEXT_MENU_EVENT,
        wait_needs_reset: true,
    };
}

function get_backward_step_index(chapter_id, steps, from_index, next_step_index) {
    const current_step = steps[from_index];
    const next_step = steps[next_step_index];
    const previous_step = steps[next_step_index - 1];

    if (
        chapter_id === "filters" &&
        current_step?.forceFilterOptions &&
        as_array(next_step?.waitFor).some(selector =>
            selector.startsWith(filter_options_popup_selector),
        ) &&
        previous_step?.waitForChange
    ) {
        return next_step_index - 1;
    }

    if (
        chapter_id === "filters" &&
        current_step?.target === filter_line_alert_selector &&
        next_step?.target === modal_apply_button_selector
    ) {
        return (
            find_previous_step_index_by_target(
                steps,
                next_step_index - 1,
                add_filter_button_alert_selector,
            ) ?? next_step_index
        );
    }

    return next_step_index;
}

function get_backward_filter_state_update(chapter_id, steps, from_index, next_step_index) {
    if (chapter_id !== "filters") return null;

    const current_step = steps[from_index];
    const next_step = steps[next_step_index];

    if (
        current_step?.target === filter_line_alert_selector &&
        next_step?.target === modal_apply_button_selector
    ) {
        return callsign_filters => remove_last_filter_by_action(callsign_filters, "alert");
    }

    if (
        current_step?.target === filter_section_show_only_selector &&
        next_step?.target === filter_line_alert_selector
    ) {
        return callsign_filters => move_last_filter_action(callsign_filters, "show_only", "alert");
    }

    return null;
}

function WebsiteTour() {
    const { propagation } = useRestData();
    const { filters, setCallsignFilters } = useFilters();
    const { radio_status } = use_radio();
    const { spots, set_spot_buffering } = useSpotData();
    const is_mobile = useMediaQuery("only screen and (max-width : 768px)");
    const [completed_chapters, set_completed_chapters] = useLocalStorage(
        TOUR_COMPLETED_CHAPTERS_KEY,
        {},
    );
    const [first_launch, set_first_launch] = useLocalStorage("first_launch", true);
    const [tour_state, set_tour_state] = useState({
        current_chapter_id: null,
        is_running: false,
        step_index: 0,
    });
    const [already_satisfied_wait_key, set_already_satisfied_wait_key] = useState(null);
    const wait_for_change_ref = useRef({ key: null, value: null });
    const backward_wait_ref = useRef({ key: null, reset_value: null, saw_unsatisfied: false });
    const pending_backward_side_effect_ref = useRef(null);

    const current_chapter = get_tour_chapter(tour_state.current_chapter_id);
    const chapter_steps = useMemo(() => current_chapter?.steps ?? [], [current_chapter]);
    const runtime_conditions = useMemo(
        () => ({
            has_spots: spots.length > 0,
            manual_band_filter_available: !filters.radio_band,
            propagation_loaded: Boolean(propagation),
            radio_available: radio_status !== "unavailable",
        }),
        [filters.radio_band, propagation, radio_status, spots.length],
    );

    const mark_chapter_done = useCallback(
        (chapter_id, status) => {
            set_completed_chapters(chapters => ({
                ...chapters,
                [chapter_id]: {
                    status,
                    completed_at: new Date().toISOString(),
                },
            }));
        },
        [set_completed_chapters],
    );

    const stop_tour = useCallback(() => {
        set_tour_state({ current_chapter_id: null, is_running: false, step_index: 0 });
    }, []);

    const finish_tour = useCallback(
        status => {
            if (tour_state.current_chapter_id && status) {
                mark_chapter_done(tour_state.current_chapter_id, status);
            }

            cleanup_chapter(tour_state.current_chapter_id);
            stop_tour();
        },
        [mark_chapter_done, stop_tour, tour_state.current_chapter_id],
    );

    const should_exclude_step = useCallback(
        step => {
            if (!step) return true;
            if (step.desktopOnly && is_mobile) return true;
            if (step.mobileOnly && !is_mobile) return true;
            if (step.requires && !requirements_are_met(step.requires, runtime_conditions))
                return true;

            return false;
        },
        [is_mobile, runtime_conditions],
    );

    const should_skip_step = useCallback(
        step => {
            if (should_exclude_step(step)) return true;
            if (step.optional && step.target && !is_selector_visible(step.target)) return true;

            return false;
        },
        [should_exclude_step],
    );

    const get_available_steps = useCallback(
        step_list => step_list.filter(step => !should_exclude_step(step)),
        [should_exclude_step],
    );

    const steps = useMemo(
        () => get_available_steps(chapter_steps),
        [chapter_steps, get_available_steps],
    );
    const first_available_step_index = useMemo(() => {
        for (let index = 0; index < steps.length; index += 1) {
            if (!should_skip_step(steps[index])) return index;
        }

        return null;
    }, [should_skip_step, steps]);
    const current_step = steps[tour_state.step_index];
    const current_wait_key = current_step
        ? get_step_wait_key(tour_state.current_chapter_id, tour_state.step_index, current_step)
        : null;
    const current_wait_for_change_key = current_step?.waitForChange
        ? `${tour_state.current_chapter_id}:${tour_state.step_index}:${current_step.waitForChange.selector}:${current_step.waitForChange.attribute ?? "text"}`
        : null;
    const current_wait_is_already_satisfied =
        current_wait_key != null && already_satisfied_wait_key === current_wait_key;
    const joyride_steps = useMemo(() => {
        return steps.map((step, index) => {
            let buttons = step.buttons;
            const placement =
                is_mobile && step.mobilePlacement ? step.mobilePlacement : step.placement;
            const hideOverlay = is_mobile && step.mobileHideOverlay ? true : step.hideOverlay;
            const scrollOffset =
                is_mobile && step.mobileScrollOffset != null
                    ? step.mobileScrollOffset
                    : step.scrollOffset;
            const width = is_mobile && step.mobileWidth != null ? step.mobileWidth : step.width;
            const floating_options =
                is_mobile && step.mobileFloatingOptions != null
                    ? step.mobileFloatingOptions
                    : step.floatingOptions;

            if (index === first_available_step_index) {
                buttons = (buttons ?? default_tour_buttons).filter(button => button !== "back");
            }

            if (
                current_wait_is_already_satisfied &&
                index === tour_state.step_index &&
                buttons &&
                !buttons.includes("primary")
            ) {
                buttons = [...buttons, "primary"];
            }

            if (
                buttons === step.buttons &&
                placement === step.placement &&
                hideOverlay === step.hideOverlay &&
                scrollOffset === step.scrollOffset &&
                width === step.width &&
                floating_options === step.floatingOptions
            ) {
                return step;
            }

            const next_step = { ...step, hideOverlay, placement, scrollOffset };
            if (buttons !== step.buttons) {
                next_step.buttons = buttons;
            }
            if (width !== step.width) {
                next_step.width = width;
            }
            if (floating_options !== step.floatingOptions) {
                next_step.floatingOptions = floating_options;
            }
            return next_step;
        });
    }, [
        current_wait_is_already_satisfied,
        first_available_step_index,
        is_mobile,
        steps,
        tour_state.step_index,
    ]);

    const find_available_step_index = useCallback(
        (step_list, start_index, direction) => {
            for (
                let index = start_index;
                index >= 0 && index < step_list.length;
                index += direction
            ) {
                if (!should_skip_step(step_list[index])) return index;
            }

            return null;
        },
        [should_skip_step],
    );

    const advance_tour = useCallback(
        (from_index, direction = 1) => {
            let next_step_index = find_available_step_index(
                steps,
                from_index + direction,
                direction,
            );

            if (next_step_index == null) {
                if (direction > 0) {
                    finish_tour(STATUS.FINISHED);
                } else {
                    set_tour_state(state => (state.is_running ? { ...state } : state));
                }
                return;
            }

            if (direction < 0) {
                const side_effect = get_backward_step_side_effect(
                    tour_state.current_chapter_id,
                    steps,
                    from_index,
                    next_step_index,
                );
                const filter_state_update = get_backward_filter_state_update(
                    tour_state.current_chapter_id,
                    steps,
                    from_index,
                    next_step_index,
                );
                next_step_index = get_backward_step_index(
                    tour_state.current_chapter_id,
                    steps,
                    from_index,
                    next_step_index,
                );
                if (steps[next_step_index]?.waitForChange) {
                    wait_for_change_ref.current = { key: null, value: null };
                }
                if (filter_state_update) {
                    setCallsignFilters(filter_state_update);
                }
                pending_backward_side_effect_ref.current = side_effect;
                backward_wait_ref.current = {
                    key: side_effect?.wait_needs_reset
                        ? get_step_wait_key(
                              tour_state.current_chapter_id,
                              next_step_index,
                              steps[next_step_index],
                          )
                        : null,
                    reset_value: side_effect?.wait_for_change_reset_value ?? null,
                    saw_unsatisfied: false,
                };
            } else {
                backward_wait_ref.current = {
                    key: null,
                    reset_value: null,
                    saw_unsatisfied: false,
                };
                pending_backward_side_effect_ref.current = null;
            }

            set_tour_state(state => {
                if (!state.is_running) return state;

                return {
                    ...state,
                    step_index: next_step_index,
                };
            });
        },
        [
            find_available_step_index,
            finish_tour,
            setCallsignFilters,
            steps,
            tour_state.current_chapter_id,
        ],
    );

    const start_tour = useCallback(
        (chapter_id = DEFAULT_TOUR_CHAPTER_ID) => {
            const chapter = get_tour_chapter(chapter_id);
            if (!chapter) return;

            if (chapter.steps.length === 0) {
                mark_chapter_done(chapter.id, STATUS.FINISHED);
                stop_tour();
                return;
            }

            const available_steps = get_available_steps(chapter.steps);
            if (available_steps.length === 0) {
                mark_chapter_done(chapter.id, STATUS.FINISHED);
                stop_tour();
                return;
            }

            if (is_mobile) {
                document.dispatchEvent(new Event(TOUR_CLOSE_LEFT_PANEL_EVENT));
                document.dispatchEvent(new Event(TOUR_CLOSE_SIDE_PANEL_EVENT));
            }

            set_tour_state({
                current_chapter_id: chapter.id,
                is_running: true,
                step_index: 0,
            });
        },
        [get_available_steps, is_mobile, mark_chapter_done, stop_tour],
    );

    useEffect(() => {
        if (first_launch !== true || tour_state.is_running) return;

        set_first_launch(false);
        start_tour(DEFAULT_TOUR_CHAPTER_ID);
    }, [first_launch, set_first_launch, start_tour, tour_state.is_running]);

    useEffect(() => {
        if (!tour_state.is_running) return;
        if (!current_step) return;
        if (!should_skip_step(current_step)) return;

        const next_step_index = find_available_step_index(steps, tour_state.step_index + 1, 1);
        if (next_step_index == null) {
            finish_tour(STATUS.FINISHED);
            return;
        }

        set_tour_state(state => ({ ...state, step_index: next_step_index }));
    }, [
        current_step,
        find_available_step_index,
        finish_tour,
        should_skip_step,
        steps,
        tour_state.is_running,
        tour_state.step_index,
    ]);

    useEffect(() => {
        if (!tour_state.is_running || !current_step?.forceFilterOptions) return;

        document.dispatchEvent(
            new CustomEvent(TOUR_FILTER_OPTIONS_EVENT, {
                detail: { ...current_step.forceFilterOptions, open: true },
            }),
        );

        return () => {
            document.dispatchEvent(
                new CustomEvent(TOUR_FILTER_OPTIONS_EVENT, {
                    detail: { ...current_step.forceFilterOptions, open: false },
                }),
            );
        };
    }, [current_step, tour_state.is_running]);

    useEffect(() => {
        if (!tour_state.is_running) {
            pending_backward_side_effect_ref.current = null;
            return;
        }

        const side_effect = pending_backward_side_effect_ref.current;
        if (!side_effect) return;

        pending_backward_side_effect_ref.current = null;
        dispatch_tour_side_effect(side_effect);
    }, [tour_state.current_chapter_id, tour_state.is_running, tour_state.step_index]);

    useEffect(() => {
        if (!tour_state.is_running) {
            backward_wait_ref.current = { key: null, reset_value: null, saw_unsatisfied: false };
            pending_backward_side_effect_ref.current = null;
            wait_for_change_ref.current = { key: null, value: null };
            set_already_satisfied_wait_key(current => (current == null ? current : null));
            return;
        }

        if (!current_step?.waitForChange) {
            wait_for_change_ref.current = { key: null, value: null };
        }

        if (!current_step?.waitFor && !current_step?.waitForGone && !current_step?.waitForChange) {
            set_already_satisfied_wait_key(current => (current == null ? current : null));
            return;
        }

        let has_advanced = false;
        const wait_for_change_key = current_wait_for_change_key;
        const wait_key = get_step_wait_key(
            tour_state.current_chapter_id,
            tour_state.step_index,
            current_step,
        );
        const has_satisfied_value = current_step.waitForChange
            ? Object.prototype.hasOwnProperty.call(current_step.waitForChange, "satisfiedValue")
            : false;
        const satisfied_value = current_step.waitForChange?.satisfiedValue;

        set_already_satisfied_wait_key(current => (current === wait_key ? current : null));

        if (current_step.waitForChange && wait_for_change_ref.current.key !== wait_for_change_key) {
            const current_change_value = get_wait_for_change_value(current_step.waitForChange);
            wait_for_change_ref.current = {
                key: wait_for_change_key,
                value: current_change_value,
            };

            if (has_satisfied_value && current_change_value === satisfied_value) {
                set_already_satisfied_wait_key(wait_key);
            }
        }

        if (
            !current_step.waitForChange &&
            current_step.showWhenAlreadySatisfied &&
            step_wait_is_satisfied(current_step)
        ) {
            if (backward_wait_ref.current.key !== wait_key) {
                set_already_satisfied_wait_key(wait_key);
                return;
            }
        }

        const set_current_step_already_satisfied = is_satisfied => {
            set_already_satisfied_wait_key(current => {
                if (is_satisfied) {
                    return current === wait_key ? current : wait_key;
                }

                return current === wait_key ? null : current;
            });
        };

        const try_advance = () => {
            if (has_advanced) return;

            if (current_step.waitForChange) {
                const current_change_value = get_wait_for_change_value(current_step.waitForChange);
                if (current_change_value == null) return;

                if (wait_for_change_ref.current.value == null) {
                    wait_for_change_ref.current = {
                        key: wait_for_change_key,
                        value: current_change_value,
                    };
                    set_current_step_already_satisfied(
                        has_satisfied_value && current_change_value === satisfied_value,
                    );
                    return;
                }

                if (backward_wait_ref.current.key === wait_key) {
                    const reset_value = backward_wait_ref.current.reset_value;
                    if (reset_value != null && current_change_value !== reset_value) return;
                    if (
                        reset_value == null &&
                        current_change_value === wait_for_change_ref.current.value
                    ) {
                        return;
                    }

                    wait_for_change_ref.current = {
                        key: wait_for_change_key,
                        value: current_change_value,
                    };
                    set_current_step_already_satisfied(
                        has_satisfied_value && current_change_value === satisfied_value,
                    );
                    backward_wait_ref.current = {
                        key: null,
                        reset_value: null,
                        saw_unsatisfied: false,
                    };
                    return;
                }

                if (
                    has_satisfied_value &&
                    wait_for_change_ref.current.value === satisfied_value &&
                    current_change_value === satisfied_value
                ) {
                    set_current_step_already_satisfied(true);
                    return;
                }

                set_current_step_already_satisfied(false);

                if (current_change_value === wait_for_change_ref.current.value) return;
            } else {
                const is_satisfied = step_wait_is_satisfied(current_step);
                if (backward_wait_ref.current.key === wait_key) {
                    if (!is_satisfied) {
                        backward_wait_ref.current.saw_unsatisfied = true;
                        return;
                    }

                    if (!backward_wait_ref.current.saw_unsatisfied) return;

                    backward_wait_ref.current = {
                        key: null,
                        reset_value: null,
                        saw_unsatisfied: false,
                    };
                } else if (!is_satisfied) {
                    return;
                }
            }

            has_advanced = true;
            advance_tour(tour_state.step_index, 1);
        };

        try_advance();
        if (has_advanced) return;

        const observer = new MutationObserver(try_advance);
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: [
                "aria-hidden",
                "aria-pressed",
                "class",
                "data-tour-state",
                "hidden",
                "style",
            ],
            childList: true,
            subtree: true,
        });
        const poll_timer = setInterval(try_advance, wait_poll_interval_ms);

        return () => {
            observer.disconnect();
            clearInterval(poll_timer);
        };
    }, [
        advance_tour,
        current_step,
        current_wait_for_change_key,
        tour_state.current_chapter_id,
        tour_state.is_running,
        tour_state.step_index,
    ]);

    useEffect(() => {
        if (!tour_state.is_running) return;

        set_spot_buffering(true);
        return () => set_spot_buffering(false);
    }, [set_spot_buffering, tour_state.is_running]);

    const handle_callback = useCallback(
        data => {
            const { action, index, status, type } = data;

            if (completed_statuses.has(status)) {
                finish_tour(status);
                return;
            }

            if (action === ACTIONS.CLOSE) {
                cleanup_chapter(tour_state.current_chapter_id);
                stop_tour();
                return;
            }

            if (type === EVENTS.TARGET_NOT_FOUND) {
                if (steps[index]?.optional) {
                    advance_tour(index, 1);
                }
                return;
            }

            if (type === EVENTS.STEP_AFTER) {
                const direction = action === ACTIONS.PREV ? -1 : 1;
                advance_tour(index, direction);
            }
        },
        [advance_tour, finish_tour, steps, stop_tour],
    );

    return (
        <>
            <TourLauncher completed_chapters={completed_chapters} on_start_tour={start_tour} />
            <Joyride
                continuous={true}
                onEvent={handle_callback}
                options={{
                    primaryColor: "#3b82f6",
                    backgroundColor: "#182229",
                    blockTargetInteraction: false,
                    buttons: default_tour_buttons,
                    textColor: "#f4f0f0",
                    arrowColor: "#182229",
                    overlayColor: "rgba(0, 0, 0, 0.65)",
                    overlayClickAction: null,
                    showProgress: true,
                    spotlightRadius: 8,
                    width: "min(360px, calc(100vw - 32px))",
                    zIndex: 10000,
                }}
                locale={{ last: "Done" }}
                run={tour_state.is_running}
                scrollToFirstStep={true}
                stepIndex={tour_state.step_index}
                steps={joyride_steps}
                styles={{
                    tooltip: {
                        border: "1px solid #334155",
                        borderRadius: 12,
                        boxShadow: "0 18px 60px rgba(0, 0, 0, 0.45)",
                        padding: 16,
                    },
                    tooltipTitle: {
                        fontSize: 18,
                        fontWeight: 700,
                    },
                    tooltipContent: {
                        fontSize: 14,
                        lineHeight: "1.5",
                    },
                    buttonPrimary: {
                        backgroundColor: "#3b82f6",
                        borderRadius: 8,
                        color: "#ffffff",
                        fontSize: 14,
                        fontWeight: 600,
                        padding: "8px 16px",
                    },
                    buttonBack: {
                        color: "#f4f0f0",
                        fontSize: 14,
                        fontWeight: 500,
                    },
                    buttonSkip: {
                        color: "#9ca3af",
                        fontSize: 13,
                        fontWeight: 500,
                    },
                    buttonClose: {
                        color: "#9ca3af",
                        height: 24,
                        width: 24,
                    },
                    overlay: {
                        height: "100%",
                        width: "100%",
                    },
                    spotlight: {
                        stroke: "#60a5fa",
                        strokeWidth: 2,
                    },
                }}
            />
        </>
    );
}

export default WebsiteTour;

import {
    TOUR_CLOSE_MAP_CONTROLS_EVENT,
    TOUR_CLOSE_MODAL_EVENT,
    TOUR_CLOSE_SIDE_PANEL_EVENT,
    TOUR_FILTER_OPTIONS_EVENT,
    TOUR_SELECT_SETTINGS_TAB_EVENT,
    TOUR_SELECT_SIDE_PANEL_TAB_EVENT,
    TOUR_TABLE_CONTEXT_MENU_EVENT,
    TOUR_TABLE_SPOT_ROW_EVENT,
} from "./tour_events.js";

const map_controls_panel_selector = "[data-tour='map-controls-panel']";
const add_filter_button_alert_selector = "[data-tour='add-filter-button-alert']";
const filter_options_popup_selector = "[data-tour='filter-options-popup']";
const filter_modal_content_selector = "[data-tour='filter-modal-content']";
const settings_modal_content_selector = "[data-tour='settings-modal-content']";
const filter_line_alert_selector = "[data-tour='filter-line-alert']";
const filter_section_show_only_selector = "[data-tour='filter-section-show_only']";
const modal_apply_button_selector = "[data-tour='modal-apply-button']";
const side_panel_selector = "[data-tour='side-panel']";
const spot_row_selector = "[data-tour='spot-row']";
const spot_row_dx_callsign_selector = "[data-tour='spot-row-dx-callsign']";
const table_context_menu_selector = "[data-tour='table-context-menu']";
const table_context_menu_state_pattern = /\[data-tour-state=['"]([^'"]+)['"]\]/;

const settings_tab_transitions = {
    "[data-tour='settings-tab-cat-control']": {
        "[data-tour='settings-distance-units']": "general",
        [settings_modal_content_selector]: "general",
    },
    "[data-tour='settings-tab-bands-modes']": {
        "[data-tour='settings-distance-units']": "general",
        "[data-tour='settings-tab-cat-control']": "cat-control",
        [settings_modal_content_selector]: "general",
    },
    "[data-tour='settings-bands-modes']": {
        "[data-tour='settings-tab-bands-modes']": "general",
        "[data-tour='settings-profiles']": "profiles",
    },
    "[data-tour='settings-tab-import-export']": {
        "[data-tour='settings-profiles']": "profiles",
        "[data-tour='settings-bands-modes']": "bands-modes",
        [settings_modal_content_selector]: "bands-modes",
    },
};

export function as_array(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
}

export function requirements_are_met(requirements, runtime_conditions) {
    return as_array(requirements).every(requirement => runtime_conditions[requirement] === true);
}

export function step_is_excluded(step, { is_mobile, runtime_conditions }) {
    if (!step) return true;
    if (step.desktopOnly && is_mobile) return true;
    if (step.mobileOnly && !is_mobile) return true;
    if (step.requires && !requirements_are_met(step.requires, runtime_conditions)) return true;

    return false;
}

export function get_available_steps(step_list, options) {
    return step_list.filter(step => !step_is_excluded(step, options));
}

export function get_step_wait_key(chapter_id, step_index, step) {
    if (!step?.waitFor && !step?.waitForGone && !step?.waitForChange) return null;

    const wait_for = as_array(step.waitFor).join("|");
    const wait_for_gone = as_array(step.waitForGone).join("|");
    const wait_for_change = step.waitForChange
        ? `${step.waitForChange.selector}:${step.waitForChange.attribute ?? "text"}`
        : "";
    return `${chapter_id}:${step.id ?? step_index}:${wait_for}:${wait_for_gone}:${wait_for_change}`;
}

export function find_available_step_index(
    step_list,
    start_index,
    direction,
    should_skip_step = () => false,
) {
    for (let index = start_index; index >= 0 && index < step_list.length; index += direction) {
        if (!should_skip_step(step_list[index])) return index;
    }

    return null;
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

function find_previous_step_index_by_target(steps, from_index, target) {
    for (let index = from_index; index >= 0; index -= 1) {
        if (steps[index]?.target === target) return index;
    }

    return null;
}

export function get_settings_tab_side_effect(current_step, next_step) {
    const label = settings_tab_transitions[current_step?.target]?.[next_step?.target];
    if (label == null) return null;

    return {
        detail: { label },
        event: TOUR_SELECT_SETTINGS_TAB_EVENT,
    };
}

export function get_backward_step_side_effect(chapter_id, steps, from_index, next_step_index) {
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

    const settings_tab_side_effect = get_settings_tab_side_effect(current_step, next_step);

    if (chapter_id === "settings" && settings_tab_side_effect) {
        return {
            ...settings_tab_side_effect,
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

export function get_backward_step_index(chapter_id, steps, from_index, next_step_index) {
    const current_step = steps[from_index];
    const next_step = steps[next_step_index];
    const previous_step = steps[next_step_index - 1];

    const settings_back_targets = {
        "[data-tour='settings-tab-cat-control']": "[data-tour='settings-distance-units']",
        "[data-tour='settings-tab-bands-modes']": "[data-tour='settings-distance-units']",
        "[data-tour='settings-tab-import-export']": "[data-tour='settings-bands-modes']",
    };
    const settings_back_target = settings_back_targets[current_step?.target];

    if (
        chapter_id === "settings" &&
        settings_back_target != null &&
        next_step?.target === settings_modal_content_selector
    ) {
        return (
            find_previous_step_index_by_target(steps, steps.length - 1, settings_back_target) ??
            next_step_index
        );
    }

    if (
        chapter_id === "settings" &&
        ["[data-tour='settings-tab-bands-modes']", "[data-tour='settings-bands-modes']"].includes(
            current_step?.target,
        )
    ) {
        return (
            find_previous_step_index_by_target(
                steps,
                steps.length - 1,
                "[data-tour='settings-distance-units']",
            ) ?? next_step_index
        );
    }

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

export function get_backward_filter_state_update(chapter_id, steps, from_index, next_step_index) {
    if (chapter_id !== "filters") return null;

    const current_step = steps[from_index];
    const next_step = steps[next_step_index];

    if (
        current_step?.target === filter_line_alert_selector &&
        next_step?.target === modal_apply_button_selector
    ) {
        return { type: "remove_last_filter", action: "alert" };
    }

    if (
        current_step?.target === filter_section_show_only_selector &&
        next_step?.target === filter_line_alert_selector
    ) {
        return {
            type: "move_last_filter",
            from_action: "show_only",
            to_action: "alert",
        };
    }

    return null;
}

export function apply_backward_filter_state_update(callsign_filters, update) {
    if (!update) return callsign_filters;

    const filters = callsign_filters?.filters ?? [];
    let filter_index = -1;
    for (let index = filters.length - 1; index >= 0; index -= 1) {
        if (
            (update.type === "remove_last_filter" && filters[index]?.action === update.action) ||
            (update.type === "move_last_filter" && filters[index]?.action === update.from_action)
        ) {
            filter_index = index;
            break;
        }
    }

    if (filter_index < 0) return callsign_filters;

    if (update.type === "remove_last_filter") {
        return {
            ...callsign_filters,
            filters: filters.filter((_, index) => index !== filter_index),
        };
    }

    const next_filters = [...filters];
    next_filters[filter_index] = {
        ...next_filters[filter_index],
        action: update.to_action,
    };
    return { ...callsign_filters, filters: next_filters };
}

export function get_tour_transition({
    chapter_id,
    steps,
    from_index,
    direction = 1,
    should_skip_step = () => false,
}) {
    const next_step_index = find_available_step_index(
        steps,
        from_index + direction,
        direction,
        should_skip_step,
    );

    if (next_step_index == null) {
        return { type: direction > 0 ? "finish" : "stay" };
    }

    if (direction > 0) {
        return {
            type: "step",
            step_index: next_step_index,
            side_effect:
                chapter_id === "settings"
                    ? get_settings_tab_side_effect(steps[from_index], steps[next_step_index])
                    : null,
            filter_state_update: null,
            reset_wait_for_change: false,
        };
    }

    const side_effect = get_backward_step_side_effect(
        chapter_id,
        steps,
        from_index,
        next_step_index,
    );
    const filter_state_update = get_backward_filter_state_update(
        chapter_id,
        steps,
        from_index,
        next_step_index,
    );
    const step_index = get_backward_step_index(chapter_id, steps, from_index, next_step_index);

    return {
        type: "step",
        step_index,
        side_effect,
        filter_state_update,
        reset_wait_for_change: Boolean(steps[step_index]?.waitForChange),
    };
}

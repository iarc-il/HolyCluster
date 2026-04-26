import { createContext, useContext, useEffect } from "react";
import { use_object_local_storage } from "@/utils.js";
import { bands, modes, continents } from "@/data/filters_data.js";

const FiltersContext = createContext(undefined);
const ZONE_CLICK_ACTION_CYCLE = ["hide", "show_only", "alert"];
const FILTER_CONFLICTING_ACTIONS = {
    show_only: "hide",
    hide: "show_only",
};

function normalize_filter_text(value) {
    return (value ?? "").toString().trim().toLowerCase();
}

function normalize_zone_value(value) {
    return Number.parseInt(value, 10);
}

function normalize_filter_criteria(filter) {
    const type = filter?.type;
    const normalized = { type };

    if (type === "prefix" || type === "suffix" || type === "entity") {
        normalized.spotter_or_dx = filter.spotter_or_dx;
        normalized.value = normalize_filter_text(filter.value);
    } else if (type === "zone") {
        normalized.zone_system = filter.zone_system || "cq";
        normalized.value = normalize_zone_value(filter.value);
    } else if (type === "comment") {
        normalized.value = normalize_filter_text(filter.value);
    }

    return normalized;
}

function is_same_filter_criteria(filter_a, filter_b) {
    const normalized_a = normalize_filter_criteria(filter_a);
    const normalized_b = normalize_filter_criteria(filter_b);

    if (normalized_a.type !== normalized_b.type) {
        return false;
    }

    if (
        normalized_a.type === "prefix" ||
        normalized_a.type === "suffix" ||
        normalized_a.type === "entity"
    ) {
        return (
            normalized_a.spotter_or_dx === normalized_b.spotter_or_dx &&
            normalized_a.value === normalized_b.value
        );
    }

    if (normalized_a.type === "zone") {
        return (
            normalized_a.zone_system === normalized_b.zone_system &&
            normalized_a.value === normalized_b.value
        );
    }

    if (normalized_a.type === "comment") {
        return normalized_a.value === normalized_b.value;
    }

    return true;
}

function filter_matches_action(filter, candidate_filter, action) {
    return filter.action === action && is_same_filter_criteria(filter, candidate_filter);
}

function evaluate_filter_add_status(existing_filters, candidate_filter) {
    const has_same_action = existing_filters.some(filter =>
        filter_matches_action(filter, candidate_filter, candidate_filter.action),
    );
    if (has_same_action) {
        return { status: "remove" };
    }

    const conflicting_action = FILTER_CONFLICTING_ACTIONS[candidate_filter.action] ?? null;
    if (conflicting_action == null) {
        return { status: "add" };
    }

    const has_conflicting_action = existing_filters.some(filter =>
        filter_matches_action(filter, candidate_filter, conflicting_action),
    );

    if (has_conflicting_action) {
        return { status: "replace", conflicting_action };
    }

    return { status: "add" };
}

function get_next_zone_action(current_action) {
    const current_index = ZONE_CLICK_ACTION_CYCLE.indexOf(current_action);
    if (current_index === -1) {
        return ZONE_CLICK_ACTION_CYCLE[0];
    }
    if (current_index === ZONE_CLICK_ACTION_CYCLE.length - 1) {
        return null;
    }
    return ZONE_CLICK_ACTION_CYCLE[current_index + 1];
}

export const useFilters = () => {
    const context = useContext(FiltersContext);
    return { ...context };
};

export const FiltersProvider = ({ children }) => {
    const initial_filters = {
        bands: Object.fromEntries(Array.from(bands).map(band => [band, true])),
        modes: Object.fromEntries(modes.map(mode => [mode, true])),
        radio_band: false,
        dx_continents: Object.fromEntries(continents.map(continent => [continent, true])),
        spotter_continents: Object.fromEntries(continents.map(continent => [continent, true])),
        time_limit: 3600,
        show_only_latest_spot: false,
        zone_filters: {
            active_system: null,
            cq_selected: [],
            itu_selected: [],
        },
    };

    const initial_callsign_filters = {
        is_alert_filters_active: true,
        is_show_only_filters_active: true,
        is_hide_filters_active: true,
        filters: [],
    };

    const [filters, setFilters] = use_object_local_storage("filters", initial_filters);
    const [callsign_filters, setCallsignFilters] = use_object_local_storage(
        "callsign_filters",
        initial_callsign_filters,
    );

    // This function changes all the keys in the filter object.
    // For example: setFilterKeys("bands", true) will enable all bands.
    function setFilterKeys(filters_key, is_active, disabled_filters = {}) {
        setFilters(state => ({
            ...state,
            [filters_key]: Object.keys(state[filters_key]).reduce((acc, key) => {
                if (is_active && disabled_filters[key]) {
                    acc[key] = false;
                } else {
                    acc[key] = is_active;
                }
                return acc;
            }, {}),
        }));
    }

    // This function set only one filter on.
    // For example: set_only_filter_keys("modes", "CW"), enables only CW.
    function setOnlyFilterKeys(filters_key, selected_key) {
        setFilters(state => ({
            ...state,
            [filters_key]: Object.fromEntries(
                Object.keys(state[filters_key]).map(key => [
                    key,
                    selected_key.toString() === key.toString(),
                ]),
            ),
        }));
    }

    function setRadioModeFilter(value) {
        setFilters(state => ({
            ...state,
            radio_band: value,
        }));
    }

    function cycle_zone_filter(system, number) {
        setCallsignFilters(state => {
            const current_filters = state.filters ?? [];
            const is_same_zone_filter = filter =>
                filter.type === "zone" &&
                filter.zone_system === system &&
                Number.parseInt(filter.value, 10) === number;
            const existing_filter = current_filters.find(is_same_zone_filter);
            const next_action = get_next_zone_action(existing_filter?.action);
            const filters_without_zone = current_filters.filter(
                filter => !is_same_zone_filter(filter),
            );

            if (next_action == null) {
                return {
                    ...state,
                    filters: filters_without_zone,
                };
            }

            return {
                ...state,
                filters: [
                    ...filters_without_zone,
                    {
                        action: next_action,
                        type: "zone",
                        value: number,
                        zone_system: system,
                        spotter_or_dx: "dx",
                    },
                ],
            };
        });
    }

    function get_filter_add_status(candidate_filter) {
        const existing_filters = callsign_filters?.filters ?? [];
        return evaluate_filter_add_status(existing_filters, candidate_filter);
    }

    function add_filter_if_allowed(candidate_filter) {
        setCallsignFilters(state => {
            const existing_filters = state.filters ?? [];
            const result = evaluate_filter_add_status(existing_filters, candidate_filter);
            if (result.status === "remove") {
                return {
                    ...state,
                    filters: existing_filters.filter(
                        filter =>
                            !filter_matches_action(
                                filter,
                                candidate_filter,
                                candidate_filter.action,
                            ),
                    ),
                };
            }

            const conflicting_action = FILTER_CONFLICTING_ACTIONS[candidate_filter.action] ?? null;
            const filters_without_conflict =
                conflicting_action == null
                    ? existing_filters
                    : existing_filters.filter(
                          filter =>
                              !filter_matches_action(filter, candidate_filter, conflicting_action),
                      );

            return {
                ...state,
                filters: [...filters_without_conflict, candidate_filter],
            };
        });
    }

    return (
        <FiltersContext.Provider
            value={{
                filters,
                setFilters,
                setFilterKeys,
                setOnlyFilterKeys,
                setRadioModeFilter,
                cycle_zone_filter,
                callsign_filters,
                setCallsignFilters,
                get_filter_add_status,
                add_filter_if_allowed,
            }}
        >
            {children}
        </FiltersContext.Provider>
    );
};

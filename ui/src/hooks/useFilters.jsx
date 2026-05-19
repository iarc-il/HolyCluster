import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { use_object_local_storage } from "@/utils.js";
import { normalize_zone_value } from "@/utils/zones.js";
import { create_initial_callsign_filters, create_initial_filters } from "@/data/filter_defaults.js";
import {
    build_filter_share_url,
    decode_filter_state,
    FILTER_URL_PARAM,
    get_filter_url_param,
} from "@/utils/filter_url_state.js";

const FiltersContext = createContext(undefined);
const ZONE_CLICK_ACTION_CYCLE = ["hide", "show_only", "alert"];
const FILTER_CONFLICTING_ACTIONS = {
    show_only: "hide",
    hide: "show_only",
};

function normalize_filter_text(value) {
    return (value ?? "").toString().trim().toLowerCase();
}

function normalize_filter_criteria(filter) {
    const type = filter?.type;
    const normalized = { type };

    if (type === "prefix" || type === "suffix" || type === "entity") {
        normalized.spotter_or_dx = filter.spotter_or_dx;
        normalized.value = normalize_filter_text(filter.value);
    } else if (type === "zone") {
        normalized.zone_system = filter.zone_system || "cq";
        normalized.value = normalize_zone_value(normalized.zone_system, filter.value);
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
    const location = useLocation();
    const navigate = useNavigate();
    const initial_filters = useMemo(() => create_initial_filters(), []);
    const initial_callsign_filters = useMemo(() => create_initial_callsign_filters(), []);
    const filter_url_value = get_filter_url_param(location.search);

    const [stored_filters, setStoredFilters] = use_object_local_storage("filters", initial_filters);
    const [stored_callsign_filters, setStoredCallsignFilters] = use_object_local_storage(
        "callsign_filters",
        initial_callsign_filters,
    );
    const [shared_filter_state, set_shared_filter_state] = useState(() =>
        decode_filter_state(filter_url_value),
    );

    useEffect(() => {
        set_shared_filter_state(decode_filter_state(filter_url_value));
    }, [filter_url_value]);

    const is_shared_filter_state = shared_filter_state != null;
    const filters = is_shared_filter_state ? shared_filter_state.filters : stored_filters;
    const callsign_filters = is_shared_filter_state
        ? shared_filter_state.callsign_filters
        : stored_callsign_filters;

    function apply_setter_value(previous_value, value_or_setter) {
        return typeof value_or_setter === "function"
            ? value_or_setter(previous_value)
            : value_or_setter;
    }

    function setFilters(value_or_setter) {
        if (!is_shared_filter_state) {
            setStoredFilters(value_or_setter);
            return;
        }

        set_shared_filter_state(state => {
            if (state == null) {
                return state;
            }

            return {
                ...state,
                filters: apply_setter_value(state.filters, value_or_setter),
            };
        });
    }

    function setCallsignFilters(value_or_setter) {
        if (!is_shared_filter_state) {
            setStoredCallsignFilters(value_or_setter);
            return;
        }

        set_shared_filter_state(state => {
            if (state == null) {
                return state;
            }

            return {
                ...state,
                callsign_filters: apply_setter_value(state.callsign_filters, value_or_setter),
            };
        });
    }

    function save_shared_filters() {
        if (!is_shared_filter_state) {
            return;
        }

        setStoredFilters(shared_filter_state.filters);
        setStoredCallsignFilters(shared_filter_state.callsign_filters);
        set_shared_filter_state(null);

        const search_params = new URLSearchParams(location.search);
        search_params.delete(FILTER_URL_PARAM);
        const next_search = search_params.toString();
        navigate(
            {
                pathname: location.pathname,
                search: next_search ? `?${next_search}` : "",
                hash: location.hash,
            },
            { replace: true },
        );
    }

    function get_filter_share_url() {
        return build_filter_share_url(filters, callsign_filters);
    }

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
                normalize_zone_value(system, filter.value) === normalize_zone_value(system, number);
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

    function get_filter_add_status(candidate_filter, exclude_filter_index = null) {
        const existing_filters = (callsign_filters?.filters ?? []).filter(
            (_, index) => exclude_filter_index == null || index !== exclude_filter_index,
        );
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
                is_shared_filter_state,
                save_shared_filters,
                get_filter_share_url,
                get_filter_add_status,
                add_filter_if_allowed,
            }}
        >
            {children}
        </FiltersContext.Provider>
    );
};

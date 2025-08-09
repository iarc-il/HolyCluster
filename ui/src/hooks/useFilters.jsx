import { createContext, useContext, useEffect } from "react";
import { use_object_local_storage } from "@/utils.js";
import { bands, modes, continents } from "@/filters_data.js";

const FiltersContext = createContext(undefined);

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
    function setFilterKeys(filters_key, is_active) {
        setFilters(state => ({
            ...state,
            [filters_key]: Object.keys(state[filters_key]).reduce((acc, key) => {
                acc[key] = is_active;
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

    return (
        <FiltersContext.Provider
            value={{
                filters,
                setFilters,
                setFilterKeys,
                setOnlyFilterKeys,
                setRadioModeFilter,
                callsign_filters,
                setCallsignFilters,
            }}
        >
            {children}
        </FiltersContext.Provider>
    );
};

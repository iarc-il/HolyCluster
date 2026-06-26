import { normalize_dxcc_entity_code } from "@/data/dxcc_entities.js";
import { create_initial_callsign_filters, create_initial_filters } from "@/data/filter_defaults.js";
import { bands, continents, modes } from "@/data/filters_data.js";
import { HUNTER_SECTION_KEYS } from "@/data/hunter_sections.js";
import { STATES } from "@/data/states.js";
import { sanitize_callsign_filters, sanitize_filters } from "@/utils/filter_url_state.js";
import Maidenhead from "maidenhead";

export const PROFILE_STORE_VERSION = 1;
export const DEFAULT_PROFILE_NAME = "Default";
export const PROFILE_STORE_KEY = "profiles";

const MAX_PROFILE_NAME_LENGTH = 60;
const MAX_TEXT_LENGTH = 160;
const MIN_DEFAULT_RADIUS_KM = 1000;
const MAX_RADIUS_KM = 20000;
const MIN_MAP_RADIUS_KM = 100;
const DEFAULT_HISTORY_WINDOW_MS = 15 * 60_000;
const MAX_HISTORY_WINDOW_MS = 8 * 60 * 60_000;
const HISTORY_DISPLAY_HOURS = new Set([8, 12, 24, 48, 72]);
const MAIN_VIEW_MODES = new Set(["both", "map", "table"]);
const MAIN_VIEW_ORDERS = new Set(["map_table", "table_map"]);
const VOACAP_BANDS = new Set(["160", "80", "60", "40", "30", "20", "17", "15", "12", "10"]);
const DXPEDITION_SORT_KEYS = new Set(["start", "end", "on_air"]);
const DXPEDITION_FILTER_KEYS = new Set(["all", "active", "upcoming"]);
const HUNTER_US_STATE_CODES = new Set(Object.keys(STATES.USA));
const HUNTER_CA_PROVINCE_CODES = new Set(Object.keys(STATES.Canada));
const HUNTER_IMPORT_COUNT_KEYS = [
    "qso_count",
    "skipped_count",
    "resolved_count",
    "unresolved_count",
    "conflict_count",
];
const TABLE_SORT_COLUMNS = new Set([
    "time",
    "dx_callsign",
    "freq",
    "band",
    "spotter_callsign",
    "mode",
]);

export const PROFILE_SECTION_DEFINITIONS = {
    settings: {
        label: "General Settings",
        description: "Station, display, units, CAT, and disabled band/mode settings",
    },
    filters: {
        label: "Band & Mode Filters",
        description: "Band, mode, continent, time, radio, and zone filters",
    },
    callsign_filters: {
        label: "Callsign Filters",
        description: "Alert, show only, and hide filter rules",
    },
    hunter: {
        label: "Hunter Progress",
        description: "Hunter worked entities and ADIF import metadata",
    },
    map_controls: {
        label: "Map Controls",
        description: "Map center, projection, night mode, and overlays",
    },
    map_view: {
        label: "Map View",
        description: "Auto-radius state and current map radius",
    },
    table_sort: {
        label: "Table Sort",
        description: "Spots table sort column and direction",
    },
    history: {
        label: "History Playback",
        description: "History window, display range, and playback speed",
    },
    panels: {
        label: "Panel Preferences",
        description: "Heatmap, frequency bar, and DXpedition list preferences",
    },
    radio: {
        label: "Radio Preferences",
        description: "Selected rig preference",
    },
};

export const PROFILE_SECTION_KEYS = Object.keys(PROFILE_SECTION_DEFINITIONS);

export const LEGACY_PROFILE_STORAGE_KEYS = {
    settings: "settings",
    filters: "filters",
    callsign_filters: "callsign_filters",
    map_controls: "map_controls",
    table_sort: "table_sort",
    auto_radius: "auto_radius",
    current_theme: "currnet_theme",
    history_window_size: "history-window-size",
    history_display_hours: "history-display-hours",
    history_time_between_shifts: "history-time-between-shifts",
    heatmap_continent: "heatmap_continent",
    frequency_bar_band: "freq_bar_selected_freq",
    dxpeditions_sort: "dxpeditions_sort",
    dxpeditions_filter: "dxpeditions_filter",
    requested_rig: "requested_rig",
};

function is_plain_object(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function to_boolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}

function to_limited_text(value, fallback = "", max_length = MAX_TEXT_LENGTH) {
    if (value == null) {
        return fallback;
    }

    const text = value.toString().trim().slice(0, max_length);
    return text.length > 0 ? text : fallback;
}

function to_number(
    value,
    fallback,
    { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, integer = false } = {},
) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    const normalized = integer ? Math.round(parsed) : parsed;
    if (normalized < min || normalized > max) {
        return fallback;
    }

    return normalized;
}

function sanitize_boolean_map(value, defaults) {
    const source = is_plain_object(value) ? value : {};
    return Object.fromEntries(
        Object.entries(defaults).map(([key, fallback]) => [key, to_boolean(source[key], fallback)]),
    );
}

function sanitize_default_radius(value, fallback) {
    const parsed = to_number(value, fallback, {
        min: MIN_DEFAULT_RADIUS_KM,
        max: MAX_RADIUS_KM,
        integer: true,
    });
    return parsed % 1000 === 0 ? parsed : fallback;
}

function sanitize_theme(value, fallback) {
    return to_limited_text(value, fallback, 40);
}

function sanitize_callsign(value, fallback) {
    return to_limited_text(value, fallback, 32).toUpperCase();
}

function sanitize_locator(value, fallback, { allow_empty = true } = {}) {
    const locator = to_limited_text(value, allow_empty ? "" : fallback, 12).toUpperCase();
    if (locator.length === 0 && allow_empty) {
        return locator;
    }

    return Maidenhead.valid(locator) ? locator : fallback;
}

function sanitize_lon_lat(value, fallback) {
    if (!Array.isArray(value) || value.length < 2) {
        return fallback;
    }

    const lon = Number(value[0]);
    const lat = Number(value[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        return fallback;
    }
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        return fallback;
    }

    return [lon, lat];
}

function sanitize_history_display_hours(value, fallback) {
    const parsed = to_number(value, fallback, { min: 1, integer: true });
    return HISTORY_DISPLAY_HOURS.has(parsed) ? parsed : fallback;
}

function sanitize_frequency_bar_band(value, fallback) {
    if (value === -1 || value === "-1") {
        return -1;
    }

    const string_value = value?.toString();
    const matching_band = bands.find(band => band.toString() === string_value);
    return matching_band ?? fallback;
}

function sanitize_voacap_band(value, fallback) {
    const string_value = value?.toString().trim().replace(/m$/i, "");
    return VOACAP_BANDS.has(string_value) ? string_value : fallback;
}

function sanitize_choice(value, fallback, valid_values) {
    return valid_values.has(value) ? value : fallback;
}

function sanitize_hunter_zone(value, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        return null;
    }
    return parsed;
}

function sanitize_hunter_state_code(value, valid_codes) {
    const code = (value ?? "").toString().trim().toUpperCase();
    return valid_codes.has(code) ? code : null;
}

function sanitize_hunter_dxcc(value) {
    return normalize_dxcc_entity_code(value);
}

function sanitize_hunter_worked_value(section, value) {
    if (section === "dxcc") return sanitize_hunter_dxcc(value);
    if (section === "cq_zone") return sanitize_hunter_zone(value, 1, 40);
    if (section === "itu_zone") return sanitize_hunter_zone(value, 1, 90);
    if (section === "us_state") return sanitize_hunter_state_code(value, HUNTER_US_STATE_CODES);
    if (section === "ca_province")
        return sanitize_hunter_state_code(value, HUNTER_CA_PROVINCE_CODES);
    return null;
}

function sanitize_hunter_worked_values(section, values) {
    const source = Array.isArray(values) ? values : [];
    const seen = new Set();
    const result = [];

    for (const value of source) {
        const normalized = sanitize_hunter_worked_value(section, value);
        if (normalized == null) continue;

        const key = `${typeof normalized}:${normalized}`;
        if (seen.has(key)) continue;

        seen.add(key);
        result.push(normalized);
    }

    return result;
}

function sanitize_hunter_worked(value) {
    const source = is_plain_object(value) ? value : {};

    return Object.fromEntries(
        HUNTER_SECTION_KEYS.map(section => {
            const section_source = is_plain_object(source[section]) ? source[section] : {};
            return [
                section,
                {
                    global: sanitize_hunter_worked_values(section, section_source.global),
                },
            ];
        }),
    );
}

function sanitize_hunter_added_counts(value) {
    const source = is_plain_object(value) ? value : {};

    return Object.fromEntries(
        HUNTER_SECTION_KEYS.map(section => [
            section,
            to_number(source[section], 0, { min: 0, integer: true }),
        ]),
    );
}

function sanitize_hunter_import(value) {
    if (!is_plain_object(value)) return null;

    return {
        file_name: to_limited_text(value.file_name, "ADIF import", 120),
        imported_at: to_number(value.imported_at, 0, { min: 0, integer: true }),
        ...Object.fromEntries(
            HUNTER_IMPORT_COUNT_KEYS.map(key => [
                key,
                to_number(value[key], 0, { min: 0, integer: true }),
            ]),
        ),
        added_counts: sanitize_hunter_added_counts(value.added_counts),
    };
}

function sanitize_hunter_imports(value) {
    if (!Array.isArray(value)) return [];
    return value.map(sanitize_hunter_import).filter(Boolean);
}

function read_storage_value(storage, key) {
    if (!storage?.getItem) {
        return undefined;
    }

    const raw_value = storage.getItem(key);
    if (raw_value == null) {
        return undefined;
    }

    try {
        return JSON.parse(raw_value);
    } catch (_error) {
        return raw_value;
    }
}

function get_browser_local_storage() {
    if (typeof window === "undefined") {
        return null;
    }

    return window.localStorage;
}

export function create_default_settings() {
    return {
        locator: "",
        default_radius: 20000,
        theme: "Dark",
        callsign: "",
        is_miles: false,
        propagation_displayed: true,
        main_view_mode: "both",
        main_view_order: "map_table",
        show_flags: true,
        show_state_abbreviations: true,
        highlight_enabled: true,
        highlight_port: 2237,
        alert_sound_enabled: false,
        disabled_bands: Object.fromEntries(bands.map(band => [band, false])),
        show_disabled_bands: false,
        disabled_modes: Object.fromEntries(modes.map(mode => [mode, false])),
        show_disabled_modes: false,
    };
}

export function create_default_map_controls() {
    return {
        night: false,
        is_globe: false,
        show_cq_zones: false,
        show_itu_zones: false,
        show_dxcc_labels: false,
        show_us_states: false,
        show_can_states: false,
        show_maidenhead_grid: false,
        show_equator: false,
        voacap_enabled: false,
        voacap_band: "20",
        voacap_step_deg: 10,
        location: {
            displayed_locator: "JJ00AA",
            location: [0, 0],
        },
    };
}

export function create_default_map_view(default_radius = 20000) {
    return {
        auto_radius: true,
        radius_in_km: default_radius,
    };
}

export function create_default_table_sort() {
    return {
        column: "time",
        ascending: false,
    };
}

export function create_default_history() {
    return {
        window_size_ms: DEFAULT_HISTORY_WINDOW_MS,
        step_size_ms: DEFAULT_HISTORY_WINDOW_MS,
        display_hours: 24,
        time_between_shifts: 3,
    };
}

export function create_default_panels() {
    return {
        heatmap_continent: "EU",
        frequency_bar_band: 20,
        dxpeditions_sort: "end",
        dxpeditions_filter: "all",
    };
}

export function create_default_radio() {
    return {
        requested_rig: 1,
    };
}

export function create_default_hunter() {
    return {
        worked: Object.fromEntries(
            HUNTER_SECTION_KEYS.map(section => [
                section,
                {
                    global: [],
                },
            ]),
        ),
        imports: [],
    };
}

export function create_default_profile_data() {
    const settings = create_default_settings();

    return {
        settings,
        filters: create_initial_filters(),
        callsign_filters: create_initial_callsign_filters(),
        hunter: create_default_hunter(),
        map_controls: create_default_map_controls(),
        map_view: create_default_map_view(settings.default_radius),
        table_sort: create_default_table_sort(),
        history: create_default_history(),
        panels: create_default_panels(),
        radio: create_default_radio(),
    };
}

export function sanitize_settings(value, defaults = create_default_settings()) {
    const source = is_plain_object(value) ? value : {};

    return {
        locator: sanitize_locator(source.locator, defaults.locator),
        default_radius: sanitize_default_radius(source.default_radius, defaults.default_radius),
        theme: sanitize_theme(source.theme, defaults.theme),
        callsign: sanitize_callsign(source.callsign, defaults.callsign),
        is_miles: to_boolean(source.is_miles, defaults.is_miles),
        propagation_displayed: to_boolean(
            source.propagation_displayed,
            defaults.propagation_displayed,
        ),
        main_view_mode: sanitize_choice(
            source.main_view_mode,
            defaults.main_view_mode,
            MAIN_VIEW_MODES,
        ),
        main_view_order: sanitize_choice(
            source.main_view_order,
            defaults.main_view_order,
            MAIN_VIEW_ORDERS,
        ),
        show_flags: to_boolean(source.show_flags, defaults.show_flags),
        show_state_abbreviations: to_boolean(
            source.show_state_abbreviations,
            defaults.show_state_abbreviations,
        ),
        highlight_enabled: to_boolean(source.highlight_enabled, defaults.highlight_enabled),
        highlight_port: to_number(source.highlight_port, defaults.highlight_port, {
            min: 1024,
            max: 65535,
            integer: true,
        }),
        alert_sound_enabled: to_boolean(source.alert_sound_enabled, defaults.alert_sound_enabled),
        disabled_bands: sanitize_boolean_map(source.disabled_bands, defaults.disabled_bands),
        show_disabled_bands: to_boolean(source.show_disabled_bands, defaults.show_disabled_bands),
        disabled_modes: sanitize_boolean_map(source.disabled_modes, defaults.disabled_modes),
        show_disabled_modes: to_boolean(source.show_disabled_modes, defaults.show_disabled_modes),
    };
}

export function sanitize_map_controls(value, defaults = create_default_map_controls()) {
    const source = is_plain_object(value) ? value : {};
    const source_location = is_plain_object(source.location) ? source.location : {};

    return {
        night: to_boolean(source.night, defaults.night),
        is_globe: to_boolean(source.is_globe, defaults.is_globe),
        show_cq_zones: to_boolean(source.show_cq_zones, defaults.show_cq_zones),
        show_itu_zones: to_boolean(source.show_itu_zones, defaults.show_itu_zones),
        show_dxcc_labels: to_boolean(source.show_dxcc_labels, defaults.show_dxcc_labels),
        show_us_states: to_boolean(source.show_us_states, defaults.show_us_states),
        show_can_states: to_boolean(source.show_can_states, defaults.show_can_states),
        show_maidenhead_grid: to_boolean(
            source.show_maidenhead_grid,
            defaults.show_maidenhead_grid,
        ),
        show_equator: to_boolean(source.show_equator, defaults.show_equator),
        voacap_enabled: to_boolean(source.voacap_enabled, defaults.voacap_enabled),
        voacap_band: sanitize_voacap_band(source.voacap_band, defaults.voacap_band),
        voacap_step_deg: to_number(source.voacap_step_deg, defaults.voacap_step_deg, {
            min: 1,
            max: 30,
            integer: true,
        }),
        location: {
            displayed_locator: sanitize_locator(
                source_location.displayed_locator,
                defaults.location.displayed_locator,
                { allow_empty: false },
            ),
            location: sanitize_lon_lat(source_location.location, defaults.location.location),
        },
    };
}

export function sanitize_map_view(value, defaults = create_default_map_view()) {
    const source = is_plain_object(value) ? value : {};

    return {
        auto_radius: to_boolean(source.auto_radius, defaults.auto_radius),
        radius_in_km: to_number(source.radius_in_km, defaults.radius_in_km, {
            min: MIN_MAP_RADIUS_KM,
            max: MAX_RADIUS_KM,
            integer: true,
        }),
    };
}

export function sanitize_table_sort(value, defaults = create_default_table_sort()) {
    const source = is_plain_object(value) ? value : {};

    return {
        column: TABLE_SORT_COLUMNS.has(source.column) ? source.column : defaults.column,
        ascending: to_boolean(source.ascending, defaults.ascending),
    };
}

export function sanitize_history(value, defaults = create_default_history()) {
    const source = is_plain_object(value) ? value : {};

    return {
        window_size_ms: to_number(source.window_size_ms, defaults.window_size_ms, {
            min: 60_000,
            max: MAX_HISTORY_WINDOW_MS,
            integer: true,
        }),
        step_size_ms: to_number(source.step_size_ms, defaults.step_size_ms, {
            min: 60_000,
            max: MAX_HISTORY_WINDOW_MS,
            integer: true,
        }),
        display_hours: sanitize_history_display_hours(source.display_hours, defaults.display_hours),
        time_between_shifts: to_number(source.time_between_shifts, defaults.time_between_shifts, {
            min: 1,
            max: 60,
            integer: true,
        }),
    };
}

export function sanitize_panels(value, defaults = create_default_panels()) {
    const source = is_plain_object(value) ? value : {};

    return {
        heatmap_continent: continents.includes(source.heatmap_continent)
            ? source.heatmap_continent
            : defaults.heatmap_continent,
        frequency_bar_band: sanitize_frequency_bar_band(
            source.frequency_bar_band,
            defaults.frequency_bar_band,
        ),
        dxpeditions_sort: sanitize_choice(
            source.dxpeditions_sort,
            defaults.dxpeditions_sort,
            DXPEDITION_SORT_KEYS,
        ),
        dxpeditions_filter: sanitize_choice(
            source.dxpeditions_filter,
            defaults.dxpeditions_filter,
            DXPEDITION_FILTER_KEYS,
        ),
    };
}

export function sanitize_radio(value, defaults = create_default_radio()) {
    const source = is_plain_object(value) ? value : {};

    return {
        requested_rig: to_number(source.requested_rig, defaults.requested_rig, {
            min: 1,
            max: 2,
            integer: true,
        }),
    };
}

export function sanitize_hunter(value, defaults = create_default_hunter()) {
    const source = is_plain_object(value) ? value : {};

    return {
        worked: sanitize_hunter_worked(source.worked),
        imports: sanitize_hunter_imports(source.imports),
    };
}

export function sanitize_profile_data(value, defaults = create_default_profile_data()) {
    const source = is_plain_object(value) ? value : {};
    const settings = sanitize_settings(source.settings, defaults.settings);
    const map_view_defaults = is_plain_object(source.map_view)
        ? defaults.map_view
        : create_default_map_view(settings.default_radius);

    return {
        settings,
        filters: sanitize_filters(source.filters ?? defaults.filters),
        callsign_filters: sanitize_callsign_filters(
            source.callsign_filters ?? defaults.callsign_filters,
        ),
        hunter: sanitize_hunter(source.hunter, defaults.hunter),
        map_controls: sanitize_map_controls(source.map_controls, defaults.map_controls),
        map_view: sanitize_map_view(source.map_view, map_view_defaults),
        table_sort: sanitize_table_sort(source.table_sort, defaults.table_sort),
        history: sanitize_history(source.history, defaults.history),
        panels: sanitize_panels(source.panels, defaults.panels),
        radio: sanitize_radio(source.radio, defaults.radio),
    };
}

export function sanitize_profile_name(value, fallback = DEFAULT_PROFILE_NAME) {
    return to_limited_text(value, fallback, MAX_PROFILE_NAME_LENGTH);
}

function normalize_existing_profile_names(existing_names, ignored_name = null) {
    const names = Array.isArray(existing_names) ? existing_names : [];

    return new Set(
        names
            .map(name_or_profile =>
                typeof name_or_profile === "string" ? name_or_profile : name_or_profile?.name,
            )
            .filter(name => name && name !== ignored_name),
    );
}

export function make_unique_profile_name(requested_name, existing_names = [], ignored_name = null) {
    const base_name = sanitize_profile_name(requested_name);
    const used_names = normalize_existing_profile_names(existing_names, ignored_name);

    if (!used_names.has(base_name)) {
        return base_name;
    }

    let index = 2;
    let candidate = `${base_name} (${index})`;
    while (used_names.has(candidate)) {
        index += 1;
        candidate = `${base_name} (${index})`;
    }

    return candidate;
}

export function sanitize_profile(value, fallback_name = DEFAULT_PROFILE_NAME) {
    const source = is_plain_object(value) ? value : {};
    const data_source = is_plain_object(source.data) ? source.data : source;

    return {
        name: sanitize_profile_name(source.name, fallback_name),
        data: sanitize_profile_data(data_source),
    };
}

export function pick_profile_sections(profile_data, section_keys = PROFILE_SECTION_KEYS) {
    const data = sanitize_profile_data(profile_data);

    return Object.fromEntries(
        section_keys
            .filter(section => PROFILE_SECTION_KEYS.includes(section))
            .map(section => [section, data[section]]),
    );
}

export function create_profile_export(profile, section_keys = PROFILE_SECTION_KEYS) {
    const sanitized_profile = sanitize_profile(profile);

    return {
        version: PROFILE_STORE_VERSION,
        name: sanitized_profile.name,
        data: pick_profile_sections(sanitized_profile.data, section_keys),
    };
}

export function sanitize_imported_profile(value, fallback_name = DEFAULT_PROFILE_NAME) {
    if (is_plain_object(value) && Array.isArray(value.profiles)) {
        const store = sanitize_profile_store(value);
        const active_profile =
            store.profiles.find(profile => profile.name === store.active_profile_name) ??
            store.profiles[0];
        return sanitize_profile(active_profile, fallback_name);
    }

    return sanitize_profile(value, fallback_name);
}

export function sanitize_profile_store(value, fallback_profile_data = null) {
    const source = is_plain_object(value) ? value : {};
    const source_profiles = Array.isArray(source.profiles) ? source.profiles : [];
    const sanitized_profiles = source_profiles.map((profile, index) =>
        sanitize_profile(profile, index === 0 ? DEFAULT_PROFILE_NAME : `Profile ${index + 1}`),
    );

    const profiles =
        sanitized_profiles.length > 0
            ? sanitized_profiles
            : [
                  {
                      name: DEFAULT_PROFILE_NAME,
                      data: sanitize_profile_data(fallback_profile_data),
                  },
              ];

    const unique_profiles = [];
    profiles.forEach(profile => {
        const name = make_unique_profile_name(profile.name, unique_profiles);
        unique_profiles.push({ ...profile, name });
    });

    const requested_active_name = sanitize_profile_name(source.active_profile_name, "");
    const active_profile_name = unique_profiles.some(
        profile => profile.name === requested_active_name,
    )
        ? requested_active_name
        : unique_profiles[0].name;

    return {
        version: PROFILE_STORE_VERSION,
        active_profile_name,
        profiles: unique_profiles,
    };
}

export function read_legacy_profile_data(storage = get_browser_local_storage()) {
    const defaults = create_default_profile_data();
    const legacy = key => read_storage_value(storage, LEGACY_PROFILE_STORAGE_KEYS[key]);
    const legacy_settings = legacy("settings");
    const legacy_theme = legacy("current_theme");
    const settings = sanitize_settings(legacy_settings, defaults.settings);

    if (legacy_settings?.theme == null && legacy_theme != null) {
        settings.theme = sanitize_theme(legacy_theme, settings.theme);
    }

    return sanitize_profile_data(
        {
            settings,
            filters: legacy("filters"),
            callsign_filters: legacy("callsign_filters"),
            map_controls: legacy("map_controls"),
            map_view: {
                auto_radius: legacy("auto_radius"),
                radius_in_km: settings.default_radius,
            },
            table_sort: legacy("table_sort"),
            history: {
                window_size_ms: legacy("history_window_size"),
                display_hours: legacy("history_display_hours"),
                time_between_shifts: legacy("history_time_between_shifts"),
            },
            panels: {
                heatmap_continent: legacy("heatmap_continent"),
                frequency_bar_band: legacy("frequency_bar_band"),
                dxpeditions_sort: legacy("dxpeditions_sort"),
                dxpeditions_filter: legacy("dxpeditions_filter"),
            },
            radio: {
                requested_rig: legacy("requested_rig"),
            },
        },
        defaults,
    );
}

export function create_profile_from_legacy_storage(
    name = DEFAULT_PROFILE_NAME,
    storage = get_browser_local_storage(),
) {
    return {
        name: sanitize_profile_name(name),
        data: read_legacy_profile_data(storage),
    };
}

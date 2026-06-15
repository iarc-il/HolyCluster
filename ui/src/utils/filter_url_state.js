import { normalize_dxcc_entity_code } from "@/data/dxcc_entities.js";
import { create_initial_callsign_filters, create_initial_filters } from "@/data/filter_defaults.js";
import { get_valid_zone_values, normalize_zone_value } from "@/utils/zones.js";

export const FILTER_URL_PARAM = "filters";

const FILTER_URL_STATE_VERSION = 1;
const FILTER_ACTIONS = new Set(["alert", "show_only", "hide"]);
const FILTER_TYPES = new Set([
    "prefix",
    "suffix",
    "entity",
    "zone",
    "comment",
    "self_spotters",
    "dxpeditions",
]);
const SPOT_SIDES = new Set(["spotter", "dx"]);
const ZONE_SYSTEMS = new Set(["cq", "itu", "us_state", "ca_province"]);
const MAX_FILTER_RULES = 200;
const MAX_TEXT_LENGTH = 160;

function is_plain_object(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function to_boolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}

function to_limited_text(value) {
    return (value ?? "").toString().trim().slice(0, MAX_TEXT_LENGTH);
}

function sanitize_boolean_map(value, defaults) {
    const source = is_plain_object(value) ? value : {};
    return Object.fromEntries(
        Object.entries(defaults).map(([key, fallback]) => [key, to_boolean(source[key], fallback)]),
    );
}

function sanitize_time_limit(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitize_zone_list(system, value) {
    if (!Array.isArray(value)) {
        return [];
    }

    const valid_values = new Set(get_valid_zone_values(system));
    const sanitized = [];
    const seen = new Set();

    value.forEach(zone_value => {
        const normalized = normalize_zone_value(system, zone_value);
        if (normalized == null || !valid_values.has(normalized) || seen.has(normalized)) {
            return;
        }

        seen.add(normalized);
        sanitized.push(normalized);
    });

    return sanitized;
}

function sanitize_zone_filters(value) {
    const disabled_by_system = value?.disabled_by_system;

    return {
        disabled_by_system: Object.fromEntries(
            Array.from(ZONE_SYSTEMS).map(system => [
                system,
                sanitize_zone_list(system, disabled_by_system?.[system]),
            ]),
        ),
    };
}

function sanitize_filter_rule(value) {
    if (!is_plain_object(value)) {
        return null;
    }

    const action = value.action;
    const type = value.type;
    if (!FILTER_ACTIONS.has(action) || !FILTER_TYPES.has(type)) {
        return null;
    }

    const filter = { action, type };

    if (type === "self_spotters" || type === "dxpeditions") {
        return filter;
    }

    if (type === "zone") {
        const zone_system = ZONE_SYSTEMS.has(value.zone_system) ? value.zone_system : "cq";
        const normalized_value = normalize_zone_value(zone_system, value.value);
        const valid_values = new Set(get_valid_zone_values(zone_system));
        if (normalized_value == null || !valid_values.has(normalized_value)) {
            return null;
        }

        return {
            ...filter,
            value: normalized_value,
            zone_system,
            spotter_or_dx: "dx",
        };
    }

    const text_value = to_limited_text(value.value);
    if (text_value.length === 0) {
        return null;
    }

    if (type === "comment") {
        const quick_filter = to_limited_text(value.quick_filter);
        return {
            ...filter,
            value: text_value,
            ...(quick_filter ? { quick_filter } : {}),
        };
    }

    if (type === "entity") {
        const dxcc_code = normalize_dxcc_entity_code(value.value);
        if (dxcc_code == null) return null;
        return {
            ...filter,
            value: dxcc_code,
            spotter_or_dx: SPOT_SIDES.has(value.spotter_or_dx) ? value.spotter_or_dx : "dx",
        };
    }

    return {
        ...filter,
        value: text_value,
        spotter_or_dx: SPOT_SIDES.has(value.spotter_or_dx) ? value.spotter_or_dx : "dx",
    };
}

export function sanitize_filters(value) {
    const defaults = create_initial_filters();
    if (!is_plain_object(value)) {
        return defaults;
    }

    return {
        bands: sanitize_boolean_map(value.bands, defaults.bands),
        modes: sanitize_boolean_map(value.modes, defaults.modes),
        radio_band: to_boolean(value.radio_band, defaults.radio_band),
        dx_continents: sanitize_boolean_map(value.dx_continents, defaults.dx_continents),
        spotter_continents: sanitize_boolean_map(
            value.spotter_continents,
            defaults.spotter_continents,
        ),
        time_limit: sanitize_time_limit(value.time_limit, defaults.time_limit),
        show_only_latest_spot: to_boolean(
            value.show_only_latest_spot,
            defaults.show_only_latest_spot,
        ),
        zone_filters: sanitize_zone_filters(value.zone_filters),
    };
}

export function sanitize_callsign_filters(value) {
    const defaults = create_initial_callsign_filters();
    if (!is_plain_object(value)) {
        return defaults;
    }

    const filter_rules = Array.isArray(value.filters)
        ? value.filters.map(sanitize_filter_rule).filter(Boolean).slice(0, MAX_FILTER_RULES)
        : defaults.filters;

    return {
        is_alert_filters_active: to_boolean(
            value.is_alert_filters_active,
            defaults.is_alert_filters_active,
        ),
        is_show_only_filters_active: to_boolean(
            value.is_show_only_filters_active,
            defaults.is_show_only_filters_active,
        ),
        is_hide_filters_active: to_boolean(
            value.is_hide_filters_active,
            defaults.is_hide_filters_active,
        ),
        filters: filter_rules,
    };
}

function encode_base64_url(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach(byte => {
        binary += String.fromCharCode(byte);
    });

    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decode_base64_url(value) {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded_base64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded_base64);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

export function encode_filter_state(filters, callsign_filters) {
    return encode_base64_url(
        JSON.stringify({
            v: FILTER_URL_STATE_VERSION,
            filters: sanitize_filters(filters),
            callsign_filters: sanitize_callsign_filters(callsign_filters),
        }),
    );
}

export function decode_filter_state(value) {
    if (!value) {
        return null;
    }

    try {
        const parsed = JSON.parse(decode_base64_url(value));
        if (!is_plain_object(parsed) || parsed.v !== FILTER_URL_STATE_VERSION) {
            return null;
        }

        return {
            filters: sanitize_filters(parsed.filters),
            callsign_filters: sanitize_callsign_filters(parsed.callsign_filters),
        };
    } catch (_error) {
        return null;
    }
}

export function get_filter_url_param(search) {
    const params = new URLSearchParams(search);
    return params.get(FILTER_URL_PARAM);
}

export function build_filter_share_url(filters, callsign_filters, base_url = window.location.href) {
    const url = new URL(base_url);
    url.searchParams.set(FILTER_URL_PARAM, encode_filter_state(filters, callsign_filters));
    return url.toString();
}

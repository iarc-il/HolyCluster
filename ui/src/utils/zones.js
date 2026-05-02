import * as d3 from "d3";
import cq_zones from "@/maps/cqzones.json";
import itu_zones from "@/maps/ituzones.json";
import us_states from "@/maps/us_states.json";

export const ZONE_CONFIG = {
    cq: {
        zones: cq_zones,
        number_key: "cq_zone_number",
        label_key: "cq_zone_number",
        loc_key: "cq_zone_name_loc",
        value_type: "number",
    },
    itu: {
        zones: itu_zones,
        number_key: "itu_zone_number",
        label_key: "itu_zone_number",
        loc_key: "itu_zone_name_loc",
        value_type: "number",
    },
    us_state: {
        zones: us_states,
        number_key: "state_code",
        label_key: "state_code",
        loc_key: "state_name_loc",
        value_type: "string",
    },
    ca_state: {
        zones: { type: "FeatureCollection", features: [] },
        number_key: "state_code",
        label_key: "state_code",
        loc_key: "state_name_loc",
        value_type: "string",
    },
};

export function get_active_overlay_systems(map_controls) {
    if (map_controls?.show_cq_zones) return ["cq"];
    if (map_controls?.show_itu_zones) return ["itu"];

    const systems = [];
    if (map_controls?.show_us_states) systems.push("us_state");
    if (map_controls?.show_can_states) systems.push("ca_state");
    return systems;
}

const zone_lookup_cache = new Map();

const ZONE_RANGE_BY_SYSTEM = {
    cq: { min: 1, max: 40 },
    itu: { min: 1, max: 90 },
};

const zone_valid_values_cache = new Map();

export function normalize_zone_value(system, zone_value) {
    const config = ZONE_CONFIG[system];
    if (!config) return null;

    if (config.value_type === "number") {
        const parsed = Number.parseInt(zone_value, 10);
        return Number.isFinite(parsed) ? parsed : null;
    }

    if (config.value_type === "string") {
        const parsed = (zone_value ?? "").toString().trim().toUpperCase();
        return parsed.length > 0 ? parsed : null;
    }

    return null;
}

export function get_valid_zone_numbers(system) {
    if (system === "us_state" || system === "ca_state") {
        const config = ZONE_CONFIG[system];
        if (!config) return [];
        return config.zones.features.map(feature => feature.properties[config.number_key]).sort();
    }

    const range = ZONE_RANGE_BY_SYSTEM[system];
    if (!range) {
        return [];
    }

    const zones = [];
    for (let zone = range.min; zone <= range.max; zone++) {
        zones.push(zone);
    }
    return zones;
}

function get_valid_zone_value_set(system) {
    if (zone_valid_values_cache.has(system)) {
        return zone_valid_values_cache.get(system);
    }

    const valid_set = new Set(get_valid_zone_numbers(system));
    zone_valid_values_cache.set(system, valid_set);
    return valid_set;
}

export function is_valid_zone_number(system, zone_number) {
    const parsed_zone = normalize_zone_value(system, zone_number);
    const range = ZONE_RANGE_BY_SYSTEM[system];
    if (range) {
        if (!Number.isFinite(parsed_zone)) return false;
        return parsed_zone >= range.min && parsed_zone <= range.max;
    }

    const valid_values = get_valid_zone_value_set(system);
    if (valid_values.size === 0 || parsed_zone == null) {
        return false;
    }
    return valid_values.has(parsed_zone);
}

function get_longitude_candidates(lon) {
    const candidates = [lon];
    if (lon < 0) {
        candidates.push(lon + 360);
    } else {
        candidates.push(lon - 360);
    }
    return candidates;
}

export function find_zone_number(system, lon_lat) {
    const config = ZONE_CONFIG[system];
    if (!config || !lon_lat) return null;

    const [lon, lat] = lon_lat;
    const cache_key = `${system}:${lon.toFixed(3)}:${lat.toFixed(3)}`;
    if (zone_lookup_cache.has(cache_key)) {
        return zone_lookup_cache.get(cache_key);
    }

    for (const candidate_lon of get_longitude_candidates(lon)) {
        const point = [candidate_lon, lat];
        for (const feature of config.zones.features) {
            if (d3.geoContains(feature, point)) {
                const zone_number = feature.properties[config.number_key];
                zone_lookup_cache.set(cache_key, zone_number);
                return zone_number;
            }
        }
    }

    zone_lookup_cache.set(cache_key, null);

    return null;
}

export function toggle_zone_selection(zone_filters, system, zone_number) {
    const disabled_by_system = zone_filters.disabled_by_system ?? {};
    const current_selected = disabled_by_system[system] ?? [];
    const normalized_zone = normalize_zone_value(system, zone_number);
    if (normalized_zone == null) {
        return zone_filters;
    }

    const has_zone = current_selected.includes(normalized_zone);
    const next_selected = has_zone
        ? current_selected.filter(value => value !== normalized_zone)
        : [...current_selected, normalized_zone].sort((a, b) => {
              if (typeof a === "number" && typeof b === "number") return a - b;
              return String(a).localeCompare(String(b));
          });

    return {
        ...zone_filters,
        disabled_by_system: {
            ...disabled_by_system,
            [system]: next_selected,
        },
    };
}

export function find_zone_label_number(system, projection, x, y, is_globe, pixel_threshold = 14) {
    const config = ZONE_CONFIG[system];
    if (!config || !projection) return null;

    const threshold_sq = pixel_threshold * pixel_threshold;
    const rotation = projection.rotate();
    let best = null;

    for (const feature of config.zones.features) {
        const [lat, lon] = feature.properties[config.loc_key];
        if (is_globe) {
            const dist = d3.geoDistance([lon, lat], [-rotation[0], -rotation[1]]);
            if (dist > Math.PI / 2) continue;
        }

        const pos = projection([lon, lat]);
        if (!pos) continue;

        const dx = pos[0] - x;
        const dy = pos[1] - y;
        const dist_sq = dx * dx + dy * dy;
        if (dist_sq > threshold_sq) continue;

        if (best == null || dist_sq < best.dist_sq) {
            best = {
                number: feature.properties[config.number_key],
                dist_sq,
            };
        }
    }

    return best?.number ?? null;
}

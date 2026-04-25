import * as d3 from "d3";
import rewind from "@mapbox/geojson-rewind";
import cq_zones from "@/assets/cqzones.json";
import itu_zones from "@/assets/ituzones.json";

function clone_feature(feature) {
    if (typeof structuredClone === "function") {
        return structuredClone(feature);
    }
    return JSON.parse(JSON.stringify(feature));
}

function prepare_features(features) {
    return features.map(feature => rewind(clone_feature(feature), true));
}

const ZONE_CONFIG = {
    cq: {
        features: prepare_features(cq_zones.features),
        number_key: "cq_zone_number",
        loc_key: "cq_zone_name_loc",
    },
    itu: {
        features: prepare_features(itu_zones.features),
        number_key: "itu_zone_number",
        loc_key: "itu_zone_name_loc",
    },
};

export const cq_zones_geojson = {
    type: "FeatureCollection",
    features: ZONE_CONFIG.cq.features,
};

export const itu_zones_geojson = {
    type: "FeatureCollection",
    features: ZONE_CONFIG.itu.features,
};

const zone_lookup_cache = new Map();

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
        for (const feature of config.features) {
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
    const selected_key = system === "cq" ? "cq_selected" : "itu_selected";
    const current_selected = zone_filters[selected_key] ?? [];
    const has_zone = current_selected.includes(zone_number);
    const next_selected = has_zone
        ? current_selected.filter(value => value !== zone_number)
        : [...current_selected, zone_number].sort((a, b) => a - b);

    return {
        ...zone_filters,
        active_system: system,
        [selected_key]: next_selected,
    };
}

export function find_zone_label_number(system, projection, x, y, is_globe, pixel_threshold = 14) {
    const config = ZONE_CONFIG[system];
    if (!config || !projection) return null;

    const threshold_sq = pixel_threshold * pixel_threshold;
    const rotation = projection.rotate();
    let best = null;

    for (const feature of config.features) {
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

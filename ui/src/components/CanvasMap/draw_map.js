import * as d3 from "d3";
import { century, equationOfTime, declination } from "solar-calculator";
import dxcc_map from "@/maps/dxcc_map.json";
import lakes from "@/maps/lakes.json";
import { is_filterable_dxcc_entity } from "@/data/dxcc_entities.js";
import { shorten_dxcc } from "@/data/flags.js";
import { country_color_indices, MAP_COUNTRY_COLORS } from "@/data/map_colors.js";
import {
    get_active_overlay_systems,
    get_label_min_area_px,
    is_label_anchor_outside_feature,
    normalize_zone_value,
    ZONE_CONFIG,
} from "@/utils/zones.js";
import { profile_map } from "./map_profile.js";

export { dxcc_map };

const MAP_STYLE = {
    background: "#e3f3f0",
    graticule: "#c4c4c4",
    land_borders: "#777777",
    borders: "#000000",
};

const color_groups = new Map();
country_color_indices.forEach((ci, fi) => {
    if (!color_groups.has(ci)) color_groups.set(ci, []);
    color_groups.get(ci).push(fi);
});

const dxcc_label_placement_cache = {
    key: null,
    placements: [],
};

function generate_concentric_circles(center_x, center_y, radius, circle_count = 6) {
    const circles = [];
    const step = radius / circle_count;
    for (let r = step; r <= radius; r += step) {
        circles.push({ cx: center_x, cy: center_y, r });
    }
    return circles;
}

function generate_radial_lines(center_x, center_y, radius, degrees_diff) {
    const lines = [];
    for (let angle = 0; angle < 360; angle += degrees_diff) {
        const radians = (angle * Math.PI) / 180;
        const x2 = center_x + radius * Math.cos(radians);
        const y2 = center_y + radius * Math.sin(radians);
        lines.push({ x1: center_x, y1: center_y, x2, y2 });
    }
    return lines;
}

function draw_night_circle(context, path_generator) {
    const now = new Date();
    const day = new Date(+now).setUTCHours(0, 0, 0, 0);
    const t = century(now);
    const longitude = ((day - now) / 864e5) * 360 - 180;
    const [sun_lon, sun_lat] = [longitude - equationOfTime(t) / 4, declination(t)];
    const sun_antipode = [sun_lon + 180, -sun_lat];

    const night_circle = d3.geoCircle().radius(90).center(sun_antipode)();

    context.beginPath();
    context.fillStyle = "rgba(0,0,170,0.3)";
    path_generator(night_circle);
    context.fill();
}

const FILTER_ACTION_STYLES = {
    hide: {
        fill: "rgba(185, 28, 28, 0.28)",
        stroke: "rgba(185, 28, 28, 0.95)",
    },
    show_only: {
        fill: "rgba(22, 163, 74, 0.24)",
        stroke: "rgba(22, 163, 74, 0.95)",
    },
    alert: {
        fill: "rgba(245, 158, 11, 0.24)",
        stroke: "rgba(245, 158, 11, 0.95)",
    },
};

const FILTER_ACTION_ACTIVE_FIELDS = {
    alert: "is_alert_filters_active",
    show_only: "is_show_only_filters_active",
    hide: "is_hide_filters_active",
};

function is_filter_action_active(callsign_filters, action) {
    const active_field = FILTER_ACTION_ACTIVE_FIELDS[action];
    return active_field == null || callsign_filters?.[active_field] !== false;
}

const DXCC_LABEL_STYLE = {
    min_font_px: 9,
    max_font_px: 16,
    hover_max_font_px: 18,
    font_scale: 0.25,
    text_width_factor: 0.62,
};

const DXCC_ENTITY_ALIASES = {
    "Agalega & St. Brandon Is.": "Agalega and St. Brandon Islands",
    "Andaman & Nicobar Is.": "Andaman and Nicobar Islands",
    "Antigua & Barbuda": "Antigua and Barbuda",
    "Baker & Howland Is.": "Baker Howland Islands",
    "Banaba I. (Ocean I.)": "Banaba Island",
    "Bosnia-Herzegovina": "Bosnia and Herzegovina",
    Bouvet: "Bouvet Island",
    "Brunei Darussalam": "Brunei",
    "C. Kiribati (British Phoenix Is.)": "Central Kiribati",
    "Central Africa": "Central African Republic",
    "Ceuta & Melilla": "Ceuta and Melilla",
    "Cote de'Ivoire": "Ivory Coast",
    "Democratic People's Rep. of Korea": "North Korea",
    "E. Kiribati (Line Is.)": "Eastern Kiribati",
    "Federal Republic of Germany": "Germany",
    Macedonia: "North Macedonia",
    "New Zealand Subantarctic Islands": "Auckland & Campbell Islands",
    "Peter 1 I.": "Peter I Island",
    "Republic of Korea": "South Korea",
    "Republic of the Congo": "Congo",
    "San Andres & Providencia": "San Andres and Providencia",
    "San Felix & San Ambrosio": "San Felix Islands",
    "South Shetland Is.": "Antarctica",
    "South Sudan (Republic of)": "South Sudan",
    "St Maarten": "Sint Maarten",
    "St. Barthelemy": "Saint Barthelemy",
    "St. Kitts & Nevis": "St. Kitts and Nevis",
    "St. Lucia": "Saint Lucia",
    "St. Peter & St. Paul Rocks": "St. Peter and St. Paul Rocks",
    "St. Pierre & Miquelon": "Saint Pierre and Miquelon",
    "St. Vincent": "Saint Vincent and the Grenadines",
    Swaziland: "Eswatini",
    "Trinidad & Tobago": "Trinidad and Tobago",
    "Tristan da Cunha & Gough I.": "Tristan da Cunha & Gough Islands",
    "Turks & Caicos Is.": "Turks and Caicos Islands",
    Vatican: "Vatican City",
    "Viet Nam": "Vietnam",
    "W. Kiribati (Gilbert Is.)": "Western Kiribati",
    "Wallis & Futuna Is.": "Wallis and Futuna Islands",
};

function expand_dxcc_island_abbreviations(dxcc_name) {
    return dxcc_name
        .replace(/\bIs\./g, "Islands")
        .replace(/\bI\./g, "Island")
        .replace(/\s+/g, " ")
        .trim();
}

export function get_dxcc_entity_name(feature) {
    const dxcc_name = feature?.properties?.dxcc_name;
    if (typeof dxcc_name !== "string") return "";

    const entity_name =
        DXCC_ENTITY_ALIASES[dxcc_name] ?? expand_dxcc_island_abbreviations(dxcc_name);
    return shorten_dxcc(entity_name);
}

function get_zone_action_map(callsign_filters, system) {
    const filters = callsign_filters?.filters ?? [];
    const zone_to_action = new Map();

    for (const filter of filters) {
        if (filter.type !== "zone" || filter.zone_system !== system) continue;
        if (!(filter.action in FILTER_ACTION_STYLES)) continue;
        if (!is_filter_action_active(callsign_filters, filter.action)) continue;
        const zone_number = normalize_zone_value(system, filter.value);
        if (zone_number == null) continue;
        zone_to_action.set(zone_number, filter.action);
    }

    return zone_to_action;
}

function normalize_dxcc_entity_filter_value(value) {
    return (value ?? "").toString().trim().toLowerCase();
}

function get_dxcc_action_map(callsign_filters) {
    const filters = callsign_filters?.filters ?? [];
    const entity_to_action = new Map();

    for (const filter of filters) {
        if (filter.type !== "entity" || filter.spotter_or_dx !== "dx") continue;
        if (!(filter.action in FILTER_ACTION_STYLES)) continue;
        if (!is_filter_action_active(callsign_filters, filter.action)) continue;
        if (!is_filterable_dxcc_entity(filter.value)) continue;
        const entity = normalize_dxcc_entity_filter_value(filter.value);
        if (!entity) continue;
        entity_to_action.set(entity, filter.action);
    }

    return entity_to_action;
}

function get_dxcc_filtered_feature_actions(dxcc_action_map) {
    const feature_actions = new Map();
    if (dxcc_action_map.size === 0) return feature_actions;

    for (let fi = 0; fi < dxcc_map.features.length; fi += 1) {
        const feature = dxcc_map.features[fi];
        const entity = normalize_dxcc_entity_filter_value(get_dxcc_entity_name(feature));
        const action = dxcc_action_map.get(entity);
        if (action) feature_actions.set(fi, action);
    }

    return feature_actions;
}

function draw_dxcc_entity_filter_fills(context, path_generator, feature_actions) {
    for (const [action, style] of Object.entries(FILTER_ACTION_STYLES)) {
        context.beginPath();
        let has_path = false;

        for (const [fi, feature_action] of feature_actions) {
            if (feature_action !== action) continue;
            path_generator(dxcc_map.features[fi]);
            has_path = true;
        }

        if (!has_path) continue;
        context.fillStyle = style.fill;
        context.fill();
    }
}

function draw_dxcc_entity_filter_strokes(context, path_generator, feature_actions) {
    for (const [action, style] of Object.entries(FILTER_ACTION_STYLES)) {
        context.beginPath();
        let has_path = false;

        for (const [fi, feature_action] of feature_actions) {
            if (feature_action !== action) continue;
            path_generator(dxcc_map.features[fi]);
            has_path = true;
        }

        if (!has_path) continue;
        context.strokeStyle = style.stroke;
        context.lineWidth = 2.8;
        context.lineJoin = "round";
        context.stroke();
    }
}

function get_zone_action_numbers(zone_action_map) {
    const action_numbers = { hide: [], show_only: [], alert: [] };
    for (const [zone_number, action] of zone_action_map) {
        action_numbers[action].push(zone_number);
    }
    return action_numbers;
}

function draw_zone_overlay(context, path_generator, zones, system, label_key, action_numbers) {
    for (const [action, style] of Object.entries(FILTER_ACTION_STYLES)) {
        const numbers = action_numbers[action] ?? [];
        const zone_set = new Set(numbers);
        if (zone_set.size === 0) continue;

        context.beginPath();
        for (const feature of zones.features) {
            const zone_number = feature.properties[label_key];
            if (zone_set.has(zone_number)) {
                path_generator(feature);
            }
        }
        context.fillStyle = style.fill;
        context.fill();
        context.strokeStyle = style.stroke;
        context.lineWidth = 2.8;
        context.lineJoin = "round";
        context.stroke();
    }

    context.beginPath();
    for (const feature of zones.features) {
        path_generator(feature);
    }
    context.strokeStyle = "rgba(0, 0, 0, 0.6)";
    context.lineWidth = 1.5;
    context.stroke();
}

function draw_zone_labels_for_system(
    context,
    projection,
    is_globe,
    zones,
    system,
    label_key,
    loc_key,
    hovered_zone_number,
    zone_action_map,
) {
    const zone_path = d3.geoPath().projection(projection);
    const MIN_FONT_PX = 9;
    const MAX_FONT_PX = 14;
    const OUTSIDE_MAX_FONT_PX = 20;
    const HOVER_MAX_FONT_PX = 16;
    const OUTSIDE_HOVER_MAX_FONT_PX = 22;
    const FONT_SCALE = 0.25;

    context.lineWidth = 1;
    const rotation = projection.rotate();
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (const feature of zones.features) {
        const area_px = zone_path.area(feature);
        const [lat, lon] = feature.properties[loc_key];
        const is_outside_polygon = is_label_anchor_outside_feature(feature, [lon, lat]);
        const min_label_area_px = get_label_min_area_px(
            system,
            feature,
            [lon, lat],
            is_outside_polygon,
        );
        if (!Number.isFinite(area_px) || area_px < min_label_area_px) continue;

        if (is_globe) {
            const dist = d3.geoDistance([lon, lat], [-rotation[0], -rotation[1]]);
            if (dist > Math.PI / 2) continue;
        }
        const pos = projection([lon, lat]);
        if (!pos) continue;
        const [x, y] = pos;
        if (!isFinite(x) || !isFinite(y)) continue;

        const zone_number = feature.properties[label_key];
        const label = String(zone_number);
        const is_hovered = hovered_zone_number != null && zone_number === hovered_zone_number;
        const outside_font_multiplier = is_outside_polygon ? 1.7 : 1;
        const max_font_px = is_outside_polygon ? OUTSIDE_MAX_FONT_PX : MAX_FONT_PX;
        const hover_max_font_px = is_outside_polygon
            ? OUTSIDE_HOVER_MAX_FONT_PX
            : HOVER_MAX_FONT_PX;
        const base_font_px = Math.max(
            MIN_FONT_PX,
            Math.min(max_font_px, Math.sqrt(area_px) * FONT_SCALE * outside_font_multiplier),
        );
        const hovered_font_px = Math.max(
            MIN_FONT_PX + 1,
            Math.min(hover_max_font_px, base_font_px + 2),
        );
        context.font = is_hovered
            ? `900 ${Math.round(hovered_font_px)}px sans-serif`
            : `bold ${Math.round(base_font_px)}px sans-serif`;
        if (is_hovered) {
            const action = zone_action_map.get(zone_number);
            const action_style = action ? FILTER_ACTION_STYLES[action] : null;
            context.strokeStyle = "rgba(255, 255, 255, 0.95)";
            context.lineWidth = 4;
            context.lineJoin = "round";
            context.miterLimit = 2;
            context.strokeText(label, x, y);
            context.fillStyle = action_style?.stroke ?? "rgba(0, 0, 0, 0.9)";
        } else {
            context.fillStyle = "rgba(0, 0, 0, 0.8)";
        }
        context.fillText(label, x, y);
    }
}

export function get_dxcc_labels_from_prefix(dxcc_prefix) {
    if (typeof dxcc_prefix !== "string") return [];

    return dxcc_prefix
        .split(",")
        .map(item => item.trim().replace(/\s+/g, " "))
        .filter(Boolean);
}

export function get_dxcc_label_from_prefix(dxcc_prefix) {
    const [first_item] = get_dxcc_labels_from_prefix(dxcc_prefix);
    if (!first_item) return "";

    return first_item.split("-")[0]?.trim() || "";
}

function get_dxcc_label_font_px(area_px, is_outside_polygon) {
    const outside_font_multiplier = is_outside_polygon ? 1.9 : 1;
    return Math.max(
        DXCC_LABEL_STYLE.min_font_px,
        Math.min(
            DXCC_LABEL_STYLE.max_font_px,
            Math.sqrt(area_px) * DXCC_LABEL_STYLE.font_scale * outside_font_multiplier,
        ),
    );
}

function estimate_dxcc_label_width_px(label, font_px) {
    return label.length * font_px * DXCC_LABEL_STYLE.text_width_factor;
}

function get_dxcc_label_width_limit_px(feature, dxcc_path, area_px) {
    const bounds = dxcc_path.bounds(feature);
    const bounds_width = Math.abs(bounds?.[1]?.[0] - bounds?.[0]?.[0]);
    if (!Number.isFinite(bounds_width) || bounds_width <= 0) return 0;

    return Math.min(bounds_width * 0.88, Math.sqrt(area_px) * 2.6);
}

function get_dxcc_label_box(x, y, label_width_px, font_px) {
    const padding_x = 4;
    const padding_y = 2;
    const half_width = label_width_px / 2 + padding_x;
    const half_height = font_px / 2 + padding_y;

    return {
        x0: x - half_width,
        y0: y - half_height,
        x1: x + half_width,
        y1: y + half_height,
    };
}

function dxcc_label_boxes_overlap(box_a, box_b) {
    return !(
        box_a.x1 <= box_b.x0 ||
        box_a.x0 >= box_b.x1 ||
        box_a.y1 <= box_b.y0 ||
        box_a.y0 >= box_b.y1
    );
}

function has_dxcc_label_collision(box, placements, ignored_index = null) {
    for (let index = 0; index < placements.length; index += 1) {
        if (index === ignored_index) continue;
        if (dxcc_label_boxes_overlap(box, placements[index].box)) return true;
    }
    return false;
}

function get_dxcc_label_placement_cache_key(projection, is_globe) {
    const rotate = projection.rotate();
    const translate = projection.translate();
    return [
        is_globe ? "globe" : "azimuthal",
        projection.scale(),
        translate[0],
        translate[1],
        rotate[0],
        rotate[1],
        rotate[2],
    ].join(":");
}

export function get_dxcc_label_data(
    feature,
    projection,
    is_globe,
    dxcc_path = null,
    feature_index = -1,
) {
    if (!feature || !projection) return null;

    const path = dxcc_path ?? d3.geoPath().projection(projection);
    const area_px = path.area(feature);
    const centroid = d3.geoCentroid(feature);
    if (!centroid || centroid.length < 2) return null;

    const [lon, lat] = centroid;
    const is_outside_polygon = is_label_anchor_outside_feature(feature, [lon, lat]);
    const min_label_area_px = get_label_min_area_px(
        "dxcc",
        feature,
        [lon, lat],
        is_outside_polygon,
    );
    if (!Number.isFinite(area_px) || area_px < min_label_area_px) return null;

    if (is_globe) {
        const rotation = projection.rotate();
        const dist = d3.geoDistance([lon, lat], [-rotation[0], -rotation[1]]);
        if (dist > Math.PI / 2) return null;
    }

    const pos = projection([lon, lat]);
    if (!pos) return null;
    const [x, y] = pos;
    if (!isFinite(x) || !isFinite(y)) return null;

    const prefix_items = get_dxcc_labels_from_prefix(feature?.properties?.dxcc_prefix);
    if (prefix_items.length === 0) return null;

    const font_px = get_dxcc_label_font_px(area_px, is_outside_polygon);
    const single_label = get_dxcc_label_from_prefix(prefix_items[0] ?? "");
    if (!single_label) return null;

    const single_label_width_px = estimate_dxcc_label_width_px(single_label, font_px);
    const single_box = get_dxcc_label_box(x, y, single_label_width_px, font_px);
    const full_label = prefix_items.join(", ");
    const full_label_width_px = estimate_dxcc_label_width_px(full_label, font_px);
    const full_label_fits_feature =
        prefix_items.length > 1 &&
        full_label !== single_label &&
        full_label_width_px <= get_dxcc_label_width_limit_px(feature, path, area_px);
    const full_box = full_label_fits_feature
        ? get_dxcc_label_box(x, y, full_label_width_px, font_px)
        : null;

    return {
        area_px,
        entity: get_dxcc_entity_name(feature),
        feature,
        feature_index,
        font_px,
        full_box,
        full_label,
        full_label_fits_feature,
        full_label_width_px,
        is_outside_polygon,
        lat,
        lon,
        single_box,
        single_label,
        single_label_width_px,
        x,
        y,
    };
}

export function get_visible_dxcc_label_placements(projection, is_globe) {
    return profile_map("dxcc_label_placements", () => {
        if (!projection) return [];

        const cache_key = get_dxcc_label_placement_cache_key(projection, is_globe);
        if (dxcc_label_placement_cache.key === cache_key) {
            return dxcc_label_placement_cache.placements;
        }

        const dxcc_path = d3.geoPath().projection(projection);
        const candidates = [];
        for (let feature_index = 0; feature_index < dxcc_map.features.length; feature_index += 1) {
            const candidate = get_dxcc_label_data(
                dxcc_map.features[feature_index],
                projection,
                is_globe,
                dxcc_path,
                feature_index,
            );
            if (candidate) candidates.push(candidate);
        }

        candidates.sort((a, b) => b.area_px - a.area_px);

        const placements = [];
        for (const candidate of candidates) {
            if (has_dxcc_label_collision(candidate.single_box, placements)) continue;

            placements.push({
                ...candidate,
                box: candidate.single_box,
                label: candidate.single_label,
                label_width_px: candidate.single_label_width_px,
            });
        }

        for (let index = 0; index < placements.length; index += 1) {
            const placement = placements[index];
            if (!placement.full_label_fits_feature || !placement.full_box) continue;
            if (has_dxcc_label_collision(placement.full_box, placements, index)) continue;

            placement.box = placement.full_box;
            placement.label = placement.full_label;
            placement.label_width_px = placement.full_label_width_px;
        }

        dxcc_label_placement_cache.key = cache_key;
        dxcc_label_placement_cache.placements = placements;

        return placements;
    });
}

export function find_dxcc_label(projection, x, y, is_globe, pixel_threshold = 14) {
    if (!projection) return null;

    let best = null;

    for (const placement of get_visible_dxcc_label_placements(projection, is_globe)) {
        const dx = placement.x - x;
        const dy = placement.y - y;
        const half_width = Math.max(pixel_threshold, placement.label_width_px / 2 + 4);
        const half_height = Math.max(pixel_threshold, placement.font_px);
        if (Math.abs(dx) > half_width || Math.abs(dy) > half_height) continue;

        const dist_sq = dx * dx + dy * dy;

        if (best == null || dist_sq < best.dist_sq) {
            best = {
                label: placement.label,
                entity: placement.entity,
                feature: placement.feature,
                feature_index: placement.feature_index,
                dist_sq,
            };
        }
    }

    if (!best) return null;

    return {
        label: best.label,
        entity: best.entity,
        feature: best.feature,
        feature_index: best.feature_index,
    };
}

function draw_dxcc_labels(context, projection, is_globe, hovered_dxcc, dxcc_action_map) {
    context.textAlign = "center";
    context.textBaseline = "middle";

    for (const placement of get_visible_dxcc_label_placements(projection, is_globe)) {
        const { entity, feature_index, font_px, label, x, y } = placement;
        const is_hovered = hovered_dxcc?.feature_index === feature_index;

        const hovered_font_px = Math.max(
            DXCC_LABEL_STYLE.min_font_px + 1,
            Math.min(DXCC_LABEL_STYLE.hover_max_font_px, font_px + 2),
        );
        context.font = is_hovered
            ? `900 ${Math.round(hovered_font_px)}px sans-serif`
            : `bold ${Math.round(font_px)}px sans-serif`;
        if (is_hovered) {
            const action = dxcc_action_map.get(normalize_dxcc_entity_filter_value(entity));
            const action_style = action ? FILTER_ACTION_STYLES[action] : null;
            context.strokeStyle = "rgba(255, 255, 255, 0.95)";
            context.lineWidth = 4;
            context.lineJoin = "round";
            context.miterLimit = 2;
            context.strokeText(label, x, y);
            context.fillStyle = action_style?.stroke ?? "rgba(0, 0, 0, 0.9)";
        } else {
            context.fillStyle = "rgba(0, 0, 0, 0.8)";
        }
        context.fillText(label, x, y);
    }
}

export function draw_zone_labels(
    context,
    dims,
    projection,
    is_globe,
    show_cq_zones,
    show_itu_zones,
    show_dxcc_labels,
    show_us_states,
    show_can_states,
    hovered_zone,
    hovered_dxcc,
    callsign_filters,
    fast = false,
) {
    if (fast) return;

    context.save();
    context.beginPath();
    context.arc(dims.center_x, dims.center_y, dims.radius, 0, 2 * Math.PI);
    context.clip();

    const active_systems = get_active_overlay_systems({
        show_cq_zones,
        show_itu_zones,
        show_us_states,
        show_can_states,
    });
    for (const system of active_systems) {
        const config = ZONE_CONFIG[system];
        if (!config) continue;
        const zone_action_map = get_zone_action_map(callsign_filters, system);
        draw_zone_labels_for_system(
            context,
            projection,
            is_globe,
            config.zones,
            system,
            config.number_key,
            config.loc_key,
            hovered_zone?.system === system ? hovered_zone.number : null,
            zone_action_map,
        );
    }

    if (show_dxcc_labels && active_systems.length === 0) {
        const dxcc_action_map = get_dxcc_action_map(callsign_filters);
        draw_dxcc_labels(context, projection, is_globe, hovered_dxcc, dxcc_action_map);
    }

    context.restore();
}

export function draw_map(
    context,
    dims,
    projection,
    night_displayed,
    show_equator,
    is_globe,
    show_cq_zones,
    show_itu_zones,
    show_us_states,
    show_can_states,
    callsign_filters,
    fast = false,
) {
    const saved_precision = projection.precision();
    if (fast) projection.precision(3);
    const path_generator = d3.geoPath().projection(projection).context(context);

    context.save();

    // Clip to circle
    context.beginPath();
    context.arc(dims.center_x, dims.center_y, dims.radius, 0, 2 * Math.PI);
    context.clip();

    // Background
    context.beginPath();
    context.arc(dims.center_x, dims.center_y, dims.radius, 0, 2 * Math.PI);
    context.fillStyle = MAP_STYLE.background;
    context.fill();

    context.lineWidth = 1;

    profile_map("draw_map.graticule", () => {
        if (!show_cq_zones && !show_itu_zones) {
            if (is_globe) {
                context.beginPath();
                path_generator(d3.geoGraticule10());
                context.strokeStyle = MAP_STYLE.graticule;
                context.stroke();
            } else {
                const full_globe_radius = projection.scale() * Math.PI;

                context.beginPath();
                generate_concentric_circles(
                    dims.center_x,
                    dims.center_y,
                    full_globe_radius,
                ).forEach(circle => {
                    context.moveTo(circle.cx + circle.r, circle.cy);
                    context.arc(circle.cx, circle.cy, circle.r, 0, 2 * Math.PI);
                });
                context.strokeStyle = MAP_STYLE.graticule;
                context.stroke();

                context.beginPath();
                generate_radial_lines(dims.center_x, dims.center_y, full_globe_radius, 15).forEach(
                    line => {
                        context.moveTo(line.x1, line.y1);
                        context.lineTo(line.x2, line.y2);
                    },
                );
                context.strokeStyle = MAP_STYLE.graticule;
                context.stroke();
            }
        }
    });

    const dxcc_feature_actions = profile_map("draw_map.dxcc_filter_actions", () => {
        const dxcc_action_map = get_dxcc_action_map(callsign_filters);
        return get_dxcc_filtered_feature_actions(dxcc_action_map);
    });

    profile_map("draw_map.dxcc_fill", () => {
        for (const [ci, feature_indices] of color_groups) {
            context.beginPath();
            for (const fi of feature_indices) {
                if (dxcc_feature_actions.has(fi)) continue;
                path_generator(dxcc_map.features[fi]);
            }
            context.fillStyle = MAP_COUNTRY_COLORS[ci];
            context.fill();
        }

        draw_dxcc_entity_filter_fills(context, path_generator, dxcc_feature_actions);
    });

    profile_map("draw_map.lakes", () => {
        context.beginPath();
        for (const feature of lakes.features) {
            path_generator(feature);
        }
        context.fillStyle = MAP_STYLE.background;
        context.fill("evenodd");
    });

    profile_map("draw_map.dxcc_borders", () => {
        context.beginPath();
        dxcc_map.features.forEach(feature => {
            path_generator(feature);
        });
        context.strokeStyle = MAP_STYLE.land_borders;
        context.stroke();

        draw_dxcc_entity_filter_strokes(context, path_generator, dxcc_feature_actions);
    });

    // Night circle
    if (night_displayed) {
        profile_map("draw_map.night", () => {
            draw_night_circle(context, path_generator);
        });
    }

    // Equator
    if (show_equator) {
        profile_map("draw_map.equator", () => {
            context.beginPath();
            context.strokeStyle = "rgb(0, 0, 0)";
            context.lineWidth = 2;
            path_generator(d3.geoCircle().radius(90).center([0, 90])());
            context.stroke();
        });
    }

    profile_map("draw_map.zone_overlays", () => {
        const active_systems = get_active_overlay_systems({
            show_cq_zones,
            show_itu_zones,
            show_us_states,
            show_can_states,
        });
        for (const system of active_systems) {
            const config = ZONE_CONFIG[system];
            if (!config) continue;
            const zone_action_map = get_zone_action_map(callsign_filters, system);
            const action_numbers = get_zone_action_numbers(zone_action_map);
            draw_zone_overlay(
                context,
                path_generator,
                config.zones,
                system,
                config.number_key,
                action_numbers,
            );
        }
    });

    context.restore();

    // Map outline
    context.beginPath();
    context.arc(dims.center_x, dims.center_y, dims.radius, 0, 2 * Math.PI);
    context.strokeStyle = MAP_STYLE.borders;
    context.stroke();

    if (!is_globe) {
        // Center red dot
        context.beginPath();
        context.arc(dims.center_x, dims.center_y, 4, 0, 2 * Math.PI);
        context.fillStyle = "#FF0000";
        context.fill();
    }

    if (fast) projection.precision(saved_precision);
}

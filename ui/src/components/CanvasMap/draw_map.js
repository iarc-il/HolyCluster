import {
    get_dxcc_label,
    is_filterable_dxcc_entity,
    normalize_dxcc_code,
    normalize_dxcc_entity_code,
} from "@/data/dxcc_entities.js";
import { normalize_dxcc_label } from "@/data/dxcc_labels.js";
import { country_color_indices } from "@/data/map_colors.js";
import dxcc_map from "@/maps/dxcc_map.json";
import lakes from "@/maps/lakes.json";
import {
    ZONE_CONFIG,
    get_active_overlay_systems,
    get_label_min_area_px,
    is_label_anchor_outside_feature,
    normalize_zone_value,
} from "@/utils/zones.js";
import * as d3 from "d3";
import { century, declination, equationOfTime } from "solar-calculator";
import { profile_map } from "./map_profile.js";

export { dxcc_map };

const color_groups = new Map();
country_color_indices.forEach((ci, fi) => {
    if (!color_groups.has(ci)) color_groups.set(ci, []);
    color_groups.get(ci).push(fi);
});

const FILTER_ACTIONS = ["hide", "show_only", "alert"];
const FILTER_ACTION_COLOR_KEYS = {
    hide: "filter_hide",
    show_only: "filter_show_only",
    alert: "filter_alert",
};
const FILTER_ACTION_FILL_ALPHA = {
    hide: 0.28,
    show_only: 0.24,
    alert: 0.24,
};

function with_alpha(color, alpha) {
    if (typeof color !== "string") return color;

    const value = color.trim();
    const short_hex_match = value.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
    if (short_hex_match) {
        const [, r, g, b] = short_hex_match;
        return with_alpha(`#${r}${r}${g}${g}${b}${b}`, alpha);
    }

    const hex_match = value.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!hex_match) return value;

    const [, r, g, b] = hex_match;
    return `rgba(${Number.parseInt(r, 16)}, ${Number.parseInt(g, 16)}, ${Number.parseInt(b, 16)}, ${alpha})`;
}

function get_filter_action_styles(map_colors) {
    return Object.fromEntries(
        FILTER_ACTIONS.map(action => {
            const color = map_colors[FILTER_ACTION_COLOR_KEYS[action]];
            return [
                action,
                {
                    fill: with_alpha(color, FILTER_ACTION_FILL_ALPHA[action]),
                    stroke: with_alpha(color, 0.95),
                },
            ];
        }),
    );
}

function get_country_color(map_country_colors, map_colors, color_index) {
    return map_country_colors[`country_${color_index}`] ?? map_colors.background;
}

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

const ZONE_LABEL_STYLE = {
    min_font_px: 9,
    max_font_px: 14,
    outside_max_font_px: 20,
    hover_max_font_px: 16,
    outside_hover_max_font_px: 22,
    font_scale: 0.25,
    outside_font_multiplier: 1.7,
    text_width_factor: 0.62,
};

const MAIDENHEAD_LABEL_STYLE = {
    min_font_px: 8,
    max_font_px: 13,
    hover_max_font_px: 14,
    font_scale: 0.25,
    outside_font_multiplier: 1,
    text_width_factor: 0.62,
};

const MAIDENHEAD_FIELD_LETTERS = "ABCDEFGHIJKLMNOPQR";
const MAIDENHEAD_SUBSQUARE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWX";
const MAIDENHEAD_GRID_LEVELS = {
    2: {
        precision: 2,
        lon_step: 20,
        lat_step: 10,
        line_alpha: 0.82,
        line_width: 1.1,
        min_label_width_px: 22,
        min_label_height_px: 14,
        max_grid_lines: 100,
        max_label_cells: 700,
    },
    4: {
        precision: 4,
        lon_step: 2,
        lat_step: 1,
        line_alpha: 0.72,
        line_width: 1,
        min_label_width_px: 26,
        min_label_height_px: 14,
        max_grid_lines: 700,
        max_label_cells: 3000,
    },
    6: {
        precision: 6,
        lon_step: 2 / 24,
        lat_step: 1 / 24,
        line_alpha: 0.45,
        line_width: 0.8,
        min_label_width_px: 34,
        min_label_height_px: 16,
        max_grid_lines: 1600,
        max_label_cells: 2600,
    },
};
const MAIDENHEAD_FOUR_GRID_MIN_SIZE_PX = { width: 28, height: 14 };
const MAIDENHEAD_SIX_GRID_MIN_SIZE_PX = { width: 32, height: 16 };
const GRID_EPSILON = 1e-9;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalize_lon(lon) {
    return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function unwrap_lon_around(lon, center_lon) {
    let unwrapped = lon;
    while (unwrapped - center_lon > 180) unwrapped -= 360;
    while (unwrapped - center_lon < -180) unwrapped += 360;
    return unwrapped;
}

function round_grid_value(value) {
    return Math.round(value * 1e10) / 1e10;
}

function get_grid_start(value, origin, step) {
    return round_grid_value(Math.floor((value - origin) / step) * step + origin);
}

function get_grid_value_count(min_value, max_value, origin, step) {
    if (max_value < min_value) return 0;
    const start = get_grid_start(min_value, origin, step);
    return Math.max(0, Math.floor((max_value - start) / step) + 1);
}

function get_adaptive_label_font_px(area_px, is_outside_polygon, style) {
    const outside_font_multiplier = is_outside_polygon ? style.outside_font_multiplier : 1;
    const max_font_px = is_outside_polygon
        ? (style.outside_max_font_px ?? style.max_font_px)
        : style.max_font_px;
    return Math.max(
        style.min_font_px,
        Math.min(max_font_px, Math.sqrt(area_px) * style.font_scale * outside_font_multiplier),
    );
}

function get_adaptive_label_hover_font_px(base_font_px, is_outside_polygon, style) {
    const hover_max_font_px = is_outside_polygon
        ? (style.outside_hover_max_font_px ?? style.hover_max_font_px)
        : style.hover_max_font_px;
    return Math.max(style.min_font_px + 1, Math.min(hover_max_font_px, base_font_px + 2));
}

function estimate_adaptive_label_width_px(label, font_px, style) {
    return label.length * font_px * style.text_width_factor;
}

function draw_adaptive_label(
    context,
    label,
    x,
    y,
    { font_px, hover_font_px, is_hovered = false, map_colors, hover_fill = null },
) {
    context.font = is_hovered
        ? `900 ${Math.round(hover_font_px)}px sans-serif`
        : `bold ${Math.round(font_px)}px sans-serif`;
    if (is_hovered) {
        context.strokeStyle = with_alpha(map_colors.label_outline, 0.95);
        context.lineWidth = 4;
        context.lineJoin = "round";
        context.miterLimit = 2;
        context.strokeText(label, x, y);
        context.fillStyle = hover_fill ?? with_alpha(map_colors.label_hover, 0.9);
    } else {
        context.fillStyle = with_alpha(map_colors.label, 0.8);
    }
    context.fillText(label, x, y);
}

function get_label_box(x, y, label_width_px, font_px) {
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

function label_boxes_overlap(box_a, box_b) {
    return !(
        box_a.x1 <= box_b.x0 ||
        box_a.x0 >= box_b.x1 ||
        box_a.y1 <= box_b.y0 ||
        box_a.y0 >= box_b.y1
    );
}

function has_label_collision(box, placements, ignored_index = null) {
    for (let index = 0; index < placements.length; index += 1) {
        if (index === ignored_index) continue;
        if (label_boxes_overlap(box, placements[index].box)) return true;
    }
    return false;
}

export function get_maidenhead_locator_label(lon, lat, precision = 6) {
    const wrapped_lon = normalize_lon(lon);
    const normalized_lon = clamp(
        wrapped_lon === -180 && lon > 0 ? 179.999999999 : wrapped_lon,
        -180,
        179.999999999,
    );
    const normalized_lat = clamp(lat, -90, 89.999999999);
    const lon_from_origin = normalized_lon + 180;
    const lat_from_origin = normalized_lat + 90;

    const field_lon = clamp(Math.floor(lon_from_origin / 20), 0, 17);
    const field_lat = clamp(Math.floor(lat_from_origin / 10), 0, 17);
    let locator = `${MAIDENHEAD_FIELD_LETTERS[field_lon]}${MAIDENHEAD_FIELD_LETTERS[field_lat]}`;
    if (precision <= 2) return locator;

    const square_lon = clamp(Math.floor((lon_from_origin - field_lon * 20) / 2), 0, 9);
    const square_lat = clamp(Math.floor(lat_from_origin - field_lat * 10), 0, 9);

    locator += `${square_lon}${square_lat}`;
    if (precision <= 4) return locator;

    const lon_remainder = lon_from_origin - field_lon * 20 - square_lon * 2;
    const lat_remainder = lat_from_origin - field_lat * 10 - square_lat;
    const subsquare_lon = clamp(
        Math.floor(lon_remainder / MAIDENHEAD_GRID_LEVELS[6].lon_step),
        0,
        23,
    );
    const subsquare_lat = clamp(
        Math.floor(lat_remainder / MAIDENHEAD_GRID_LEVELS[6].lat_step),
        0,
        23,
    );

    locator += `${MAIDENHEAD_SUBSQUARE_LETTERS[subsquare_lon]}${MAIDENHEAD_SUBSQUARE_LETTERS[subsquare_lat]}`;
    return locator;
}

function get_projected_center_cell_size(projection, dims, lon_step, lat_step) {
    const center_lon_lat = projection.invert([dims.center_x, dims.center_y]);
    if (!center_lon_lat) return { width: 0, height: 0 };

    const [lon, lat] = center_lon_lat;
    const clamped_lat = clamp(lat, -89.9, 89.9);
    const center = projection([normalize_lon(lon), clamped_lat]);
    const lon_edge = projection([normalize_lon(lon + lon_step), clamped_lat]);
    const lat_edge_lat =
        clamped_lat + lat_step <= 89.9 ? clamped_lat + lat_step : clamped_lat - lat_step;
    const lat_edge = projection([normalize_lon(lon), lat_edge_lat]);
    if (!center || !lon_edge || !lat_edge) return { width: 0, height: 0 };

    return {
        width: Math.hypot(lon_edge[0] - center[0], lon_edge[1] - center[1]),
        height: Math.hypot(lat_edge[0] - center[0], lat_edge[1] - center[1]),
    };
}

function get_maidenhead_grid_level(projection, dims) {
    const six_cell_size = get_projected_center_cell_size(
        projection,
        dims,
        MAIDENHEAD_GRID_LEVELS[6].lon_step,
        MAIDENHEAD_GRID_LEVELS[6].lat_step,
    );
    if (
        six_cell_size.width >= MAIDENHEAD_SIX_GRID_MIN_SIZE_PX.width &&
        six_cell_size.height >= MAIDENHEAD_SIX_GRID_MIN_SIZE_PX.height
    ) {
        return MAIDENHEAD_GRID_LEVELS[6];
    }

    const four_cell_size = get_projected_center_cell_size(
        projection,
        dims,
        MAIDENHEAD_GRID_LEVELS[4].lon_step,
        MAIDENHEAD_GRID_LEVELS[4].lat_step,
    );
    if (
        four_cell_size.width >= MAIDENHEAD_FOUR_GRID_MIN_SIZE_PX.width &&
        four_cell_size.height >= MAIDENHEAD_FOUR_GRID_MIN_SIZE_PX.height
    ) {
        return MAIDENHEAD_GRID_LEVELS[4];
    }

    return MAIDENHEAD_GRID_LEVELS[2];
}

function add_visible_geo_sample(projection, x, y, center_lon, samples) {
    const lon_lat = projection.invert([x, y]);
    if (!lon_lat) return;
    const [lon, lat] = lon_lat;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

    samples.push({
        lon: unwrap_lon_around(normalize_lon(lon), center_lon),
        lat: clamp(lat, -90, 90),
    });
}

function get_visible_geo_bounds(projection, dims, lon_step, lat_step) {
    const center_lon_lat = projection.invert([dims.center_x, dims.center_y]) ?? [0, 0];
    const center_lon = normalize_lon(center_lon_lat[0] ?? 0);
    const samples = [];
    const sample_count = 8;

    for (let y_index = 0; y_index <= sample_count; y_index += 1) {
        const y = dims.center_y - dims.radius + (2 * dims.radius * y_index) / sample_count;
        for (let x_index = 0; x_index <= sample_count; x_index += 1) {
            const x = dims.center_x - dims.radius + (2 * dims.radius * x_index) / sample_count;
            const dx = x - dims.center_x;
            const dy = y - dims.center_y;
            if (dx * dx + dy * dy > dims.radius * dims.radius) continue;
            add_visible_geo_sample(projection, x, y, center_lon, samples);
        }
    }

    for (let index = 0; index < 32; index += 1) {
        const angle = (index / 32) * 2 * Math.PI;
        add_visible_geo_sample(
            projection,
            dims.center_x + Math.cos(angle) * dims.radius,
            dims.center_y + Math.sin(angle) * dims.radius,
            center_lon,
            samples,
        );
    }

    if (samples.length === 0) {
        return {
            center_lon,
            lon_min: center_lon - 180,
            lon_max: center_lon + 180,
            lat_min: -90,
            lat_max: 90,
        };
    }

    const lon_values = samples.map(sample => sample.lon);
    const lat_values = samples.map(sample => sample.lat);
    const lon_padding = lon_step * 2;
    const lat_padding = lat_step * 2;

    return {
        center_lon,
        lon_min: Math.max(center_lon - 180, Math.min(...lon_values) - lon_padding),
        lon_max: Math.min(center_lon + 180, Math.max(...lon_values) + lon_padding),
        lat_min: clamp(Math.min(...lat_values) - lat_padding, -90, 90),
        lat_max: clamp(Math.max(...lat_values) + lat_padding, -90, 90),
    };
}

function get_maidenhead_grid_render_state(projection, dims) {
    let config = get_maidenhead_grid_level(projection, dims);
    let bounds = get_visible_geo_bounds(projection, dims, config.lon_step, config.lat_step);
    const line_count =
        get_grid_value_count(bounds.lon_min, bounds.lon_max, -180, config.lon_step) +
        get_grid_value_count(bounds.lat_min, bounds.lat_max, -90, config.lat_step);

    if (config.precision === 6 && line_count > config.max_grid_lines) {
        config = MAIDENHEAD_GRID_LEVELS[4];
        bounds = get_visible_geo_bounds(projection, dims, config.lon_step, config.lat_step);
    }

    const center_cell_size = get_projected_center_cell_size(
        projection,
        dims,
        config.lon_step,
        config.lat_step,
    );

    return { bounds, center_cell_size, config };
}

function build_segmented_line(start, end, step, build_coordinate) {
    const coordinates = [];
    if (end < start) return coordinates;

    coordinates.push(build_coordinate(start));
    let current = round_grid_value(start + step);
    while (current < end - GRID_EPSILON) {
        coordinates.push(build_coordinate(current));
        current = round_grid_value(current + step);
    }
    coordinates.push(build_coordinate(end));

    return coordinates;
}

function build_maidenhead_grid_lines(bounds, config) {
    const lines = [];
    const lon_segment_step = Math.min(1, config.lon_step);
    const lat_segment_step = Math.min(1, config.lat_step);

    for (
        let lon = get_grid_start(bounds.lon_min, -180, config.lon_step);
        lon <= bounds.lon_max + GRID_EPSILON;
        lon = round_grid_value(lon + config.lon_step)
    ) {
        lines.push(
            build_segmented_line(bounds.lat_min, bounds.lat_max, lat_segment_step, lat => [
                normalize_lon(lon),
                lat,
            ]),
        );
    }

    for (
        let lat = get_grid_start(bounds.lat_min, -90, config.lat_step);
        lat <= bounds.lat_max + GRID_EPSILON;
        lat = round_grid_value(lat + config.lat_step)
    ) {
        lines.push(
            build_segmented_line(bounds.lon_min, bounds.lon_max, lon_segment_step, lon => [
                normalize_lon(lon),
                lat,
            ]),
        );
    }

    return lines.filter(line => line.length >= 2);
}

function draw_maidenhead_grid(context, path_generator, projection, dims, map_colors) {
    const { bounds, config } = get_maidenhead_grid_render_state(projection, dims);
    const lines = build_maidenhead_grid_lines(bounds, config);
    if (lines.length === 0) return;

    context.beginPath();
    path_generator({ type: "MultiLineString", coordinates: lines });
    context.strokeStyle = with_alpha(map_colors.graticule, config.line_alpha);
    context.lineWidth = config.line_width;
    context.stroke();
}

function get_projected_cell_metrics(projection, dims, lon_min, lat_min, config) {
    const lon_max = lon_min + config.lon_step;
    const lat_max = lat_min + config.lat_step;
    const center_lon = normalize_lon(lon_min + config.lon_step / 2);
    const center_lat = lat_min + config.lat_step / 2;
    const center = projection([center_lon, center_lat]);
    if (!center) return null;

    const [x, y] = center;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const dx = x - dims.center_x;
    const dy = y - dims.center_y;
    if (dx * dx + dy * dy > dims.radius * dims.radius) return null;

    const corners = [
        [normalize_lon(lon_min), lat_min],
        [normalize_lon(lon_max), lat_min],
        [normalize_lon(lon_max), lat_max],
        [normalize_lon(lon_min), lat_max],
    ]
        .map(corner => projection(corner))
        .filter(Boolean);
    if (corners.length !== 4) return null;

    let area_px = 0;
    for (let index = 0; index < corners.length; index += 1) {
        const [x1, y1] = corners[index];
        const [x2, y2] = corners[(index + 1) % corners.length];
        if (
            !Number.isFinite(x1) ||
            !Number.isFinite(y1) ||
            !Number.isFinite(x2) ||
            !Number.isFinite(y2)
        ) {
            return null;
        }
        area_px += x1 * y2 - x2 * y1;
    }
    area_px = Math.abs(area_px) / 2;

    const xs = corners.map(corner => corner[0]);
    const ys = corners.map(corner => corner[1]);
    return {
        area_px,
        center_lat,
        center_lon,
        height_px: Math.max(...ys) - Math.min(...ys),
        width_px: Math.max(...xs) - Math.min(...xs),
        x,
        y,
    };
}

function draw_maidenhead_labels(context, dims, projection, is_globe, map_colors) {
    const { bounds, center_cell_size, config } = get_maidenhead_grid_render_state(projection, dims);
    if (
        center_cell_size.width < config.min_label_width_px ||
        center_cell_size.height < config.min_label_height_px
    ) {
        return;
    }

    const lon_cell_count = get_grid_value_count(
        bounds.lon_min,
        bounds.lon_max,
        -180,
        config.lon_step,
    );
    const lat_cell_count = get_grid_value_count(
        bounds.lat_min,
        bounds.lat_max,
        -90,
        config.lat_step,
    );
    if (lon_cell_count * lat_cell_count > config.max_label_cells) return;

    const rotation = projection.rotate();
    const placements = [];
    context.textAlign = "center";
    context.textBaseline = "middle";

    for (
        let lat = get_grid_start(bounds.lat_min, -90, config.lat_step);
        lat < bounds.lat_max - GRID_EPSILON;
        lat = round_grid_value(lat + config.lat_step)
    ) {
        if (lat < -90 || lat + config.lat_step > 90 + GRID_EPSILON) continue;

        for (
            let lon = get_grid_start(bounds.lon_min, -180, config.lon_step);
            lon < bounds.lon_max - GRID_EPSILON;
            lon = round_grid_value(lon + config.lon_step)
        ) {
            const center_lon = normalize_lon(lon + config.lon_step / 2);
            const center_lat = lat + config.lat_step / 2;
            if (is_globe) {
                const dist = d3.geoDistance([center_lon, center_lat], [-rotation[0], -rotation[1]]);
                if (dist > Math.PI / 2) continue;
            }

            const metrics = get_projected_cell_metrics(projection, dims, lon, lat, config);
            if (!metrics || !Number.isFinite(metrics.area_px) || metrics.area_px <= 0) continue;

            const label = get_maidenhead_locator_label(center_lon, center_lat, config.precision);
            const font_px = get_adaptive_label_font_px(
                metrics.area_px,
                false,
                MAIDENHEAD_LABEL_STYLE,
            );
            const label_width_px = estimate_adaptive_label_width_px(
                label,
                font_px,
                MAIDENHEAD_LABEL_STYLE,
            );
            if (label_width_px > metrics.width_px * 0.9 || font_px > metrics.height_px * 0.85) {
                continue;
            }

            const box = get_label_box(metrics.x, metrics.y, label_width_px, font_px);
            if (has_label_collision(box, placements)) continue;

            placements.push({
                box,
                font_px,
                label,
                x: metrics.x,
                y: metrics.y,
            });
        }
    }

    for (const placement of placements) {
        draw_adaptive_label(context, placement.label, placement.x, placement.y, {
            font_px: placement.font_px,
            hover_font_px: placement.font_px,
            map_colors,
        });
    }
}

function draw_night_circle(context, path_generator, map_colors, time = null) {
    const now = time ?? new Date();
    const day = new Date(+now).setUTCHours(0, 0, 0, 0);
    const t = century(now);
    const longitude = ((day - now) / 864e5) * 360 - 180;
    const [sun_lon, sun_lat] = [longitude - equationOfTime(t) / 4, declination(t)];
    const sun_antipode = [sun_lon + 180, -sun_lat];

    const night_circle = d3.geoCircle().radius(90).center(sun_antipode)();

    context.beginPath();
    context.fillStyle = with_alpha(map_colors.night_overlay, 0.3);
    path_generator(night_circle);
    context.fill();
}

const FILTER_ACTION_ACTIVE_FIELDS = {
    alert: "is_alert_filters_active",
    show_only: "is_show_only_filters_active",
    hide: "is_hide_filters_active",
};

function is_filter_action_active(callsign_filters, action) {
    const active_field = FILTER_ACTION_ACTIVE_FIELDS[action];
    return active_field == null || callsign_filters?.[active_field] !== false;
}

function merge_overlay_action_map(action_map, overlay_action_map) {
    for (const [value, action] of overlay_action_map ?? []) {
        if (!(action in FILTER_ACTION_COLOR_KEYS)) continue;
        if (!action_map.has(value)) action_map.set(value, action);
    }
}

const DXCC_LABEL_STYLE = {
    min_font_px: 9,
    max_font_px: 16,
    hover_max_font_px: 18,
    font_scale: 0.25,
    text_width_factor: 0.62,
};

export function get_dxcc_entity_name(feature) {
    const dxcc_code = normalize_dxcc_code(feature?.properties?.dxcc_entity_code);
    const label = get_dxcc_label(dxcc_code);
    if (label) return label;

    const dxcc_name = feature?.properties?.dxcc_name;
    if (typeof dxcc_name !== "string") return "";

    return normalize_dxcc_label(dxcc_name);
}

function get_zone_action_map(callsign_filters, system, overlay_highlights = null) {
    const filters = callsign_filters?.filters ?? [];
    const zone_to_action = new Map();

    merge_overlay_action_map(zone_to_action, overlay_highlights?.zones?.[system]);

    for (const filter of filters) {
        if (filter.type !== "zone" || filter.zone_system !== system) continue;
        if (!(filter.action in FILTER_ACTION_COLOR_KEYS)) continue;
        if (!is_filter_action_active(callsign_filters, filter.action)) continue;
        const zone_number = normalize_zone_value(system, filter.value);
        if (zone_number == null) continue;
        zone_to_action.set(zone_number, filter.action);
    }

    return zone_to_action;
}

function get_dxcc_action_map(callsign_filters, overlay_highlights = null) {
    const filters = callsign_filters?.filters ?? [];
    const entity_to_action = new Map();

    merge_overlay_action_map(entity_to_action, overlay_highlights?.dxcc);

    for (const filter of filters) {
        if (filter.type !== "entity" || filter.spotter_or_dx !== "dx") continue;
        if (!(filter.action in FILTER_ACTION_COLOR_KEYS)) continue;
        if (!is_filter_action_active(callsign_filters, filter.action)) continue;
        if (!is_filterable_dxcc_entity(filter.value)) continue;
        const entity = normalize_dxcc_entity_code(filter.value);
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
        const entity = normalize_dxcc_entity_code(feature?.properties?.dxcc_entity_code);
        const action = dxcc_action_map.get(entity);
        if (action) feature_actions.set(fi, action);
    }

    return feature_actions;
}

function draw_dxcc_entity_filter_fills(
    context,
    path_generator,
    feature_actions,
    filter_action_styles,
) {
    for (const [action, style] of Object.entries(filter_action_styles)) {
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

function draw_dxcc_entity_filter_strokes(
    context,
    path_generator,
    feature_actions,
    filter_action_styles,
) {
    for (const [action, style] of Object.entries(filter_action_styles)) {
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

function can_use_path2d() {
    return typeof Path2D !== "undefined";
}

function build_dxcc_feature_paths(projection) {
    if (!can_use_path2d()) return null;

    const feature_paths = [];
    const path_generator = d3.geoPath().projection(projection);
    for (const feature of dxcc_map.features) {
        const feature_path = new Path2D();
        path_generator.context(feature_path)(feature);
        feature_paths.push(feature_path);
    }

    return feature_paths;
}

function draw_dxcc_entity_filter_fills_from_paths(
    context,
    feature_paths,
    feature_actions,
    filter_action_styles,
) {
    for (const [action, style] of Object.entries(filter_action_styles)) {
        const action_path = new Path2D();
        let has_path = false;

        for (const [fi, feature_action] of feature_actions) {
            if (feature_action !== action) continue;
            action_path.addPath(feature_paths[fi]);
            has_path = true;
        }

        if (!has_path) continue;
        context.fillStyle = style.fill;
        context.fill(action_path);
    }
}

function draw_dxcc_entity_filter_strokes_from_paths(
    context,
    feature_paths,
    feature_actions,
    filter_action_styles,
) {
    for (const [action, style] of Object.entries(filter_action_styles)) {
        const action_path = new Path2D();
        let has_path = false;

        for (const [fi, feature_action] of feature_actions) {
            if (feature_action !== action) continue;
            action_path.addPath(feature_paths[fi]);
            has_path = true;
        }

        if (!has_path) continue;
        context.strokeStyle = style.stroke;
        context.lineWidth = 2.8;
        context.lineJoin = "round";
        context.stroke(action_path);
    }
}

function get_zone_action_numbers(zone_action_map) {
    const action_numbers = { hide: [], show_only: [], alert: [] };
    for (const [zone_number, action] of zone_action_map) {
        action_numbers[action].push(zone_number);
    }
    return action_numbers;
}

function draw_zone_overlay(
    context,
    path_generator,
    zones,
    system,
    label_key,
    action_numbers,
    map_colors,
    filter_action_styles,
) {
    for (const [action, style] of Object.entries(filter_action_styles)) {
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
    context.strokeStyle = with_alpha(map_colors.zone_border, 0.6);
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
    map_colors,
    filter_action_styles,
) {
    const zone_path = d3.geoPath().projection(projection);

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
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        const zone_number = feature.properties[label_key];
        const label = String(zone_number);
        const is_hovered = hovered_zone_number != null && zone_number === hovered_zone_number;
        const base_font_px = get_adaptive_label_font_px(
            area_px,
            is_outside_polygon,
            ZONE_LABEL_STYLE,
        );
        const hovered_font_px = get_adaptive_label_hover_font_px(
            base_font_px,
            is_outside_polygon,
            ZONE_LABEL_STYLE,
        );
        const action = is_hovered ? zone_action_map.get(zone_number) : null;
        const action_style = action ? filter_action_styles[action] : null;
        draw_adaptive_label(context, label, x, y, {
            font_px: base_font_px,
            hover_font_px: hovered_font_px,
            is_hovered,
            map_colors,
            hover_fill: action_style?.stroke,
        });
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
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const prefix_items = get_dxcc_labels_from_prefix(feature?.properties?.dxcc_prefix);
    if (prefix_items.length === 0) return null;

    const font_px = get_dxcc_label_font_px(area_px, is_outside_polygon);
    const single_label = get_dxcc_label_from_prefix(prefix_items[0] ?? "");
    if (!single_label) return null;

    const single_label_width_px = estimate_dxcc_label_width_px(single_label, font_px);
    const single_box = get_label_box(x, y, single_label_width_px, font_px);
    const full_label = prefix_items.join(", ");
    const full_label_width_px = estimate_dxcc_label_width_px(full_label, font_px);
    const full_label_fits_feature =
        full_label !== single_label &&
        full_label_width_px <= get_dxcc_label_width_limit_px(feature, path, area_px);
    const full_box = full_label_fits_feature
        ? get_label_box(x, y, full_label_width_px, font_px)
        : null;

    return {
        area_px,
        entity: normalize_dxcc_code(feature?.properties?.dxcc_entity_code),
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
            if (has_label_collision(candidate.single_box, placements)) continue;

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
            if (has_label_collision(placement.full_box, placements, index)) continue;

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
                x: placement.x,
                y: placement.y,
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
        x: best.x,
        y: best.y,
    };
}

function draw_dxcc_labels(
    context,
    projection,
    is_globe,
    hovered_dxcc,
    dxcc_action_map,
    map_colors,
    filter_action_styles,
) {
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
            const action_style = action ? filter_action_styles[action] : null;
            context.strokeStyle = with_alpha(map_colors.label_outline, 0.95);
            context.lineWidth = 4;
            context.lineJoin = "round";
            context.miterLimit = 2;
            context.strokeText(label, x, y);
            context.fillStyle = action_style?.stroke ?? with_alpha(map_colors.label_hover, 0.9);
        } else {
            context.fillStyle = with_alpha(map_colors.label, 0.8);
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
    show_maidenhead_grid,
    hovered_zone,
    hovered_dxcc,
    callsign_filters,
    overlay_highlights,
    map_colors,
    fast = false,
) {
    if (fast) return;

    const filter_action_styles = get_filter_action_styles(map_colors);

    context.save();
    context.beginPath();
    context.arc(dims.center_x, dims.center_y, dims.radius, 0, 2 * Math.PI);
    context.clip();

    if (show_maidenhead_grid) {
        draw_maidenhead_labels(context, dims, projection, is_globe, map_colors);
        context.restore();
        return;
    }

    const active_systems = get_active_overlay_systems({
        show_cq_zones,
        show_itu_zones,
        show_us_states,
        show_can_states,
    });
    for (const system of active_systems) {
        const config = ZONE_CONFIG[system];
        if (!config) continue;
        const zone_action_map = get_zone_action_map(callsign_filters, system, overlay_highlights);
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
            map_colors,
            filter_action_styles,
        );
    }

    if (show_dxcc_labels && active_systems.length === 0) {
        const dxcc_action_map = get_dxcc_action_map(callsign_filters, overlay_highlights);
        draw_dxcc_labels(
            context,
            projection,
            is_globe,
            hovered_dxcc,
            dxcc_action_map,
            map_colors,
            filter_action_styles,
        );
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
    show_maidenhead_grid,
    callsign_filters,
    overlay_highlights,
    map_colors,
    map_country_colors,
    fast = false,
    night_time = null,
) {
    const filter_action_styles = get_filter_action_styles(map_colors);
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
    context.fillStyle = map_colors.background;
    context.fill();

    context.lineWidth = 1;

    profile_map("draw_map.graticule", () => {
        if (!show_maidenhead_grid && !show_cq_zones && !show_itu_zones) {
            if (is_globe) {
                context.beginPath();
                path_generator(d3.geoGraticule10());
                context.strokeStyle = map_colors.graticule;
                context.stroke();
            } else {
                const full_globe_radius = projection.scale() * Math.PI;

                context.beginPath();
                for (const circle of generate_concentric_circles(
                    dims.center_x,
                    dims.center_y,
                    full_globe_radius,
                )) {
                    context.moveTo(circle.cx + circle.r, circle.cy);
                    context.arc(circle.cx, circle.cy, circle.r, 0, 2 * Math.PI);
                }
                context.strokeStyle = map_colors.graticule;
                context.stroke();

                context.beginPath();
                for (const line of generate_radial_lines(
                    dims.center_x,
                    dims.center_y,
                    full_globe_radius,
                    15,
                )) {
                    context.moveTo(line.x1, line.y1);
                    context.lineTo(line.x2, line.y2);
                }
                context.strokeStyle = map_colors.graticule;
                context.stroke();
            }
        }
    });

    const dxcc_feature_actions = profile_map("draw_map.dxcc_filter_actions", () => {
        const dxcc_action_map = get_dxcc_action_map(callsign_filters, overlay_highlights);
        return get_dxcc_filtered_feature_actions(dxcc_action_map);
    });
    const dxcc_feature_paths = profile_map("draw_map.dxcc_paths", () =>
        build_dxcc_feature_paths(projection),
    );

    profile_map("draw_map.dxcc_fill", () => {
        if (dxcc_feature_paths) {
            for (const [ci, feature_indices] of color_groups) {
                const color_path = new Path2D();
                let has_path = false;

                for (const fi of feature_indices) {
                    if (dxcc_feature_actions.has(fi)) continue;
                    color_path.addPath(dxcc_feature_paths[fi]);
                    has_path = true;
                }

                if (!has_path) continue;
                context.fillStyle = get_country_color(map_country_colors, map_colors, ci);
                context.fill(color_path);
            }

            draw_dxcc_entity_filter_fills_from_paths(
                context,
                dxcc_feature_paths,
                dxcc_feature_actions,
                filter_action_styles,
            );
        } else {
            for (const [ci, feature_indices] of color_groups) {
                context.beginPath();
                for (const fi of feature_indices) {
                    if (dxcc_feature_actions.has(fi)) continue;
                    path_generator(dxcc_map.features[fi]);
                }
                context.fillStyle = get_country_color(map_country_colors, map_colors, ci);
                context.fill();
            }

            draw_dxcc_entity_filter_fills(
                context,
                path_generator,
                dxcc_feature_actions,
                filter_action_styles,
            );
        }
    });

    profile_map("draw_map.lakes", () => {
        context.beginPath();
        for (const feature of lakes.features) {
            path_generator(feature);
        }
        context.fillStyle = map_colors.background;
        context.fill("evenodd");
    });

    profile_map("draw_map.dxcc_borders", () => {
        if (dxcc_feature_paths) {
            const border_path = new Path2D();
            for (const feature_path of dxcc_feature_paths) {
                border_path.addPath(feature_path);
            }

            context.strokeStyle = map_colors.land_borders;
            context.stroke(border_path);

            draw_dxcc_entity_filter_strokes_from_paths(
                context,
                dxcc_feature_paths,
                dxcc_feature_actions,
                filter_action_styles,
            );
        } else {
            context.beginPath();
            dxcc_map.features.forEach(path_generator);
            context.strokeStyle = map_colors.land_borders;
            context.stroke();

            draw_dxcc_entity_filter_strokes(
                context,
                path_generator,
                dxcc_feature_actions,
                filter_action_styles,
            );
        }
    });

    // Night circle
    if (night_displayed) {
        profile_map("draw_map.night", () => {
            draw_night_circle(context, path_generator, map_colors, night_time);
        });
    }

    // Equator
    if (show_equator) {
        profile_map("draw_map.equator", () => {
            context.beginPath();
            context.strokeStyle = map_colors.equator;
            context.lineWidth = 2;
            path_generator(d3.geoCircle().radius(90).center([0, 90])());
            context.stroke();
        });
    }

    if (show_maidenhead_grid) {
        profile_map("draw_map.maidenhead_grid", () => {
            draw_maidenhead_grid(context, path_generator, projection, dims, map_colors);
        });
    }

    profile_map("draw_map.zone_overlays", () => {
        const active_systems = show_maidenhead_grid
            ? []
            : get_active_overlay_systems({
                  show_cq_zones,
                  show_itu_zones,
                  show_us_states,
                  show_can_states,
              });
        for (const system of active_systems) {
            const config = ZONE_CONFIG[system];
            if (!config) continue;
            const zone_action_map = get_zone_action_map(
                callsign_filters,
                system,
                overlay_highlights,
            );
            const action_numbers = get_zone_action_numbers(zone_action_map);
            draw_zone_overlay(
                context,
                path_generator,
                config.zones,
                system,
                config.number_key,
                action_numbers,
                map_colors,
                filter_action_styles,
            );
        }
    });

    context.restore();

    // Map outline
    context.beginPath();
    context.arc(dims.center_x, dims.center_y, dims.radius, 0, 2 * Math.PI);
    context.strokeStyle = map_colors.borders;
    context.stroke();

    if (!is_globe) {
        // Center red dot
        context.beginPath();
        context.arc(dims.center_x, dims.center_y, 4, 0, 2 * Math.PI);
        context.fillStyle = map_colors.center_dot;
        context.fill();
    }

    if (fast) projection.precision(saved_precision);
}

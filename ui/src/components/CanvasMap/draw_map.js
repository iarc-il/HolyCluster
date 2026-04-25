import * as d3 from "d3";
import { century, equationOfTime, declination } from "solar-calculator";
import dxcc_map from "@/assets/dxcc_map.json";
import lakes from "@/assets/lakes.json";
import { country_color_indices, MAP_COUNTRY_COLORS } from "@/data/map_colors.js";
import { cq_zones_geojson, itu_zones_geojson } from "@/utils/zones.js";

export { dxcc_map };

const color_groups = new Map();
country_color_indices.forEach((ci, fi) => {
    if (!color_groups.has(ci)) color_groups.set(ci, []);
    color_groups.get(ci).push(fi);
});

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

const ZONE_ACTION_STYLES = {
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

function get_zone_action_numbers(callsign_filters, system) {
    const filters = callsign_filters?.filters ?? [];
    const zone_to_action = new Map();

    for (const filter of filters) {
        if (filter.type !== "zone" || filter.zone_system !== system) continue;
        if (!(filter.action in ZONE_ACTION_STYLES)) continue;
        const zone_number = Number.parseInt(filter.value, 10);
        if (!Number.isFinite(zone_number)) continue;
        zone_to_action.set(zone_number, filter.action);
    }

    const action_numbers = { hide: [], show_only: [], alert: [] };
    for (const [zone_number, action] of zone_to_action) {
        action_numbers[action].push(zone_number);
    }

    return action_numbers;
}

function get_zone_action_map(callsign_filters, system) {
    const filters = callsign_filters?.filters ?? [];
    const zone_to_action = new Map();

    for (const filter of filters) {
        if (filter.type !== "zone" || filter.zone_system !== system) continue;
        if (!(filter.action in ZONE_ACTION_STYLES)) continue;
        const zone_number = Number.parseInt(filter.value, 10);
        if (!Number.isFinite(zone_number)) continue;
        zone_to_action.set(zone_number, filter.action);
    }

    return zone_to_action;
}

function draw_zone_overlay(context, path_generator, zones, label_key, action_numbers) {
    for (const [action, style] of Object.entries(ZONE_ACTION_STYLES)) {
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
    label_key,
    loc_key,
    hovered_zone_number,
    zone_action_map,
) {
    context.lineWidth = 1;
    const rotation = projection.rotate();
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (const feature of zones.features) {
        const [lat, lon] = feature.properties[loc_key];
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
        context.font = is_hovered ? "900 17px sans-serif" : "bold 14px sans-serif";
        if (is_hovered) {
            const action = zone_action_map.get(zone_number);
            const action_style = action ? ZONE_ACTION_STYLES[action] : null;
            context.strokeStyle = "rgba(255, 255, 255, 0.95)";
            context.lineWidth = 4;
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
    hovered_zone,
    callsign_filters,
) {
    context.save();
    context.beginPath();
    context.arc(dims.center_x, dims.center_y, dims.radius, 0, 2 * Math.PI);
    context.clip();

    if (show_cq_zones) {
        const cq_zone_action_map = get_zone_action_map(callsign_filters, "cq");
        draw_zone_labels_for_system(
            context,
            projection,
            is_globe,
            cq_zones_geojson,
            "cq_zone_number",
            "cq_zone_name_loc",
            hovered_zone?.system === "cq" ? hovered_zone.number : null,
            cq_zone_action_map,
        );
    }

    if (show_itu_zones) {
        const itu_zone_action_map = get_zone_action_map(callsign_filters, "itu");
        draw_zone_labels_for_system(
            context,
            projection,
            is_globe,
            itu_zones_geojson,
            "itu_zone_number",
            "itu_zone_name_loc",
            hovered_zone?.system === "itu" ? hovered_zone.number : null,
            itu_zone_action_map,
        );
    }

    context.restore();
}

export function draw_map(
    context,
    colors,
    dims,
    projection,
    night_displayed,
    show_equator,
    is_globe,
    show_cq_zones,
    show_itu_zones,
    callsign_filters,
    fast = false,
) {
    const saved_precision = projection.precision();
    if (fast) projection.precision(2);
    const path_generator = d3.geoPath().projection(projection).context(context);

    context.save();

    // Clip to circle
    context.beginPath();
    context.arc(dims.center_x, dims.center_y, dims.radius, 0, 2 * Math.PI);
    context.clip();

    // Background
    context.beginPath();
    context.arc(dims.center_x, dims.center_y, dims.radius, 0, 2 * Math.PI);
    context.fillStyle = colors.map.background;
    context.fill();

    context.lineWidth = 1;

    if (is_globe) {
        context.beginPath();
        path_generator(d3.geoGraticule10());
        context.strokeStyle = colors.map.graticule;
        context.stroke();
    } else {
        const full_globe_radius = projection.scale() * Math.PI;

        context.beginPath();
        generate_concentric_circles(dims.center_x, dims.center_y, full_globe_radius).forEach(
            circle => {
                context.moveTo(circle.cx + circle.r, circle.cy);
                context.arc(circle.cx, circle.cy, circle.r, 0, 2 * Math.PI);
            },
        );
        context.strokeStyle = colors.map.graticule;
        context.stroke();

        context.beginPath();
        generate_radial_lines(dims.center_x, dims.center_y, full_globe_radius, 15).forEach(line => {
            context.moveTo(line.x1, line.y1);
            context.lineTo(line.x2, line.y2);
        });
        context.strokeStyle = colors.map.graticule;
        context.stroke();
    }

    for (const [ci, feature_indices] of color_groups) {
        context.beginPath();
        for (const fi of feature_indices) {
            path_generator(dxcc_map.features[fi]);
        }
        context.fillStyle = MAP_COUNTRY_COLORS[ci];
        context.fill();
    }

    context.beginPath();
    for (const feature of lakes.features) {
        path_generator(feature);
    }
    context.fillStyle = colors.map.background;
    context.fill("evenodd");

    context.beginPath();
    dxcc_map.features.forEach(feature => {
        path_generator(feature);
    });
    context.strokeStyle = colors.map.land_borders;
    context.stroke();

    // Night circle
    if (night_displayed) {
        draw_night_circle(context, path_generator);
    }

    // Equator
    if (show_equator) {
        context.beginPath();
        context.strokeStyle = "rgb(0, 0, 0)";
        context.lineWidth = 2;
        path_generator(d3.geoCircle().radius(90).center([0, 90])());
        context.stroke();
    }

    // CQ Zones
    if (show_cq_zones) {
        const cq_action_numbers = get_zone_action_numbers(callsign_filters, "cq");
        draw_zone_overlay(
            context,
            path_generator,
            cq_zones_geojson,
            "cq_zone_number",
            cq_action_numbers,
        );
    }

    // ITU Zones
    if (show_itu_zones) {
        const itu_action_numbers = get_zone_action_numbers(callsign_filters, "itu");
        draw_zone_overlay(
            context,
            path_generator,
            itu_zones_geojson,
            "itu_zone_number",
            itu_action_numbers,
        );
    }

    context.restore();

    // Map outline
    context.beginPath();
    context.arc(dims.center_x, dims.center_y, dims.radius, 0, 2 * Math.PI);
    context.strokeStyle = colors.map.borders;
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

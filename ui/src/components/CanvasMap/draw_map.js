import * as d3 from "d3";
import { century, equationOfTime, declination } from "solar-calculator";
import geojsonRewind from "@mapbox/geojson-rewind";

import dxcc_map_raw from "@/assets/dxcc_map.json";

export const dxcc_map = geojsonRewind(dxcc_map_raw, true);

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
    context.fillStyle = "rgba(0,0,128,0.2)";
    path_generator(night_circle);
    context.fill();
}

export function draw_map(context, colors, dims, projection, night_displayed, show_equator) {
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

    // Concentric circles
    generate_concentric_circles(dims.center_x, dims.center_y, dims.radius).forEach(circle => {
        context.beginPath();
        context.arc(circle.cx, circle.cy, circle.r, 0, 2 * Math.PI);
        context.strokeStyle = colors.map.graticule;
        context.stroke();
    });

    // Radial lines
    generate_radial_lines(dims.center_x, dims.center_y, dims.radius, 15).forEach(line => {
        context.beginPath();
        context.moveTo(line.x1, line.y1);
        context.lineTo(line.x2, line.y2);
        context.strokeStyle = colors.map.graticule;
        context.stroke();
    });

    // DXCC country paths
    dxcc_map.features.forEach(feature => {
        context.beginPath();
        path_generator(feature);
        context.fillStyle = colors.map.land;
        context.strokeStyle = colors.map.land_borders;
        context.fill();
        context.stroke();
    });

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

    context.restore();

    // Map outline
    context.beginPath();
    context.arc(dims.center_x, dims.center_y, dims.radius, 0, 2 * Math.PI);
    context.strokeStyle = colors.map.borders;
    context.stroke();

    // Center red dot
    context.beginPath();
    context.arc(dims.center_x, dims.center_y, 4, 0, 2 * Math.PI);
    context.fillStyle = "#FF0000";
    context.fill();
}

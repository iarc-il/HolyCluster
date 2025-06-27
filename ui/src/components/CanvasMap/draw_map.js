import * as d3 from "d3";
import { century, equationOfTime, declination } from "solar-calculator";
import geojsonRewind from "@mapbox/geojson-rewind";

import { to_radian, calculate_geographic_azimuth } from "@/utils.js";
import dxcc_map_raw from "@/assets/dxcc_map.json";

export const dxcc_map = geojsonRewind(dxcc_map_raw, true);

function draw_night_circle(context, { path_generator }) {
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

export function build_geojson_line(spot) {
    return {
        type: "LineString",
        coordinates: [spot.spotter_loc, spot.dx_loc],
        properties: {
            band: spot.band,
            freq: Number(spot.freq) * 1000,
            mode: spot.mode,
        },
    };
}

function draw_spot_dx(context, spot, color, stroke_color, dx_x, dx_y, dx_size, transform) {
    context.beginPath();
    context.strokeStyle = stroke_color;
    context.fillStyle = color;
    context.lineWidth = 1 / transform.k;
    if (spot.mode === "SSB") {
        context.rect(dx_x - dx_size / 2, dx_y - dx_size / 2, dx_size, dx_size);
    } else if (spot.mode === "CW") {
        context.moveTo(dx_x, dx_y - dx_size / 2);
        context.lineTo(dx_x - dx_size / 2, dx_y + dx_size / 2);
        context.lineTo(dx_x + dx_size / 2, dx_y + dx_size / 2);
    } else {
        dx_size = dx_size / 1.6;
        const hex_points = [];
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i;
            const x = dx_x + dx_size * Math.cos(angle);
            const y = dx_y + dx_size * Math.sin(angle);
            hex_points.push([x, y]);
        }

        context.moveTo(hex_points[0][0], hex_points[0][1]);
        for (let i = 1; i < hex_points.length; i++) {
            context.lineTo(hex_points[i][0], hex_points[i][1]);
        }
    }
    context.closePath();
    context.fill();
    context.stroke();
}

function draw_spot(
    context,
    spot,
    colors,
    dash_offset,
    { is_bold, transform, path_generator, projection },
) {
    const line = build_geojson_line(spot);

    // Render the arc of the spot
    context.beginPath();
    if (is_bold) {
        context.strokeStyle = colors.light_bands[spot.band];
        context.lineWidth = 6;
    } else {
        context.strokeStyle = colors.bands[spot.band];
        context.lineWidth = 2;
    }
    context.lineWidth = context.lineWidth / transform.k;
    if (spot.is_alerted) {
        context.setLineDash([10 / transform.k, 10 / transform.k]);
        context.lineDashOffset = dash_offset / transform.k;
    } else {
        context.setLineDash([]);
    }
    path_generator(line);
    context.stroke();

    const dx_size = (is_bold ? 12 : 10) / transform.k;
    const [dx_x, dx_y] = projection(spot.dx_loc);

    draw_spot_dx(
        context,
        spot,
        colors.light_bands[spot.band],
        "grey",
        dx_x,
        dx_y,
        dx_size,
        transform,
    );

    const [spotter_x, spotter_y] = projection(spot.spotter_loc);
    const spotter_radius = (is_bold ? 5 : 3) / transform.k;

    context.beginPath();

    context.strokeStyle = "grey";
    context.fillStyle = colors.light_bands[spot.band];
    context.lineWidth = 1 / transform.k;

    context.arc(spotter_x, spotter_y, spotter_radius, 0, 2 * Math.PI);
    context.fill();
    context.stroke();
}

function rgb_triplet_to_color([red, green, blue]) {
    return `rgb(${red}, ${green}, ${blue})`;
}

function draw_shadow_spot(
    context,
    spot,
    shadow_palette,
    { transform, path_generator, projection },
) {
    const line = build_geojson_line(spot);

    // Render the arc of the spot
    context.beginPath();
    context.strokeStyle = rgb_triplet_to_color(shadow_palette.get(["arc", spot.id]));
    context.lineWidth = 8 / transform.k;
    path_generator(line);
    context.stroke();

    const dx_size = 12 / transform.k;
    const [dx_x, dx_y] = projection(spot.dx_loc);

    // Render the dx rectangle
    const dx_color = rgb_triplet_to_color(shadow_palette.get(["dx", spot.id]));
    draw_spot_dx(context, spot, dx_color, dx_color, dx_x, dx_y, dx_size, transform);

    const [spotter_x, spotter_y] = projection(spot.spotter_loc);
    const spotter_radius = 7 / transform.k;

    context.beginPath();
    context.fillStyle = rgb_triplet_to_color(shadow_palette.get(["spotter", spot.id]));
    context.lineWidth = 2 / transform.k;
    context.arc(spotter_x, spotter_y, spotter_radius, 0, 2 * Math.PI);
    context.fill();
}

export function apply_context_transform(context, transform) {
    context.setTransform(transform.k, 0, 0, transform.k, transform.x, transform.y, 1, 1, 1);
}

export class Dimensions {
    constructor(width, height, inner_padding) {
        this.width = width;
        this.height = height;
        this.inner_padding = inner_padding;

        this.center_x = width / 2;
        this.center_y = height / 2;
        this.radius = Math.min(this.center_x, this.center_y) - inner_padding;

        this.padded_size = [width - inner_padding * 2, height - inner_padding * 2];
        // Heuristics for the scale of the map. This is good enough
        this.scale = Math.max(Math.min(height / 900, 1.1), 0.5);
    }
}

function generate_concentric_circles(center_x, center_y, radius, circle_count = 6) {
    const circles = [];
    const step = radius / circle_count;
    for (let r = step; r <= radius; r += step) {
        circles.push({
            cx: center_x,
            cy: center_y,
            r: r,
        });
    }
    return circles;
}

function generate_radial_lines(center_x, center_y, radius, degrees_diff) {
    const lines = [];
    for (let angle = 0; angle < 360; angle += degrees_diff) {
        const radians = (angle * Math.PI) / 180;
        const x2 = center_x + radius * Math.cos(radians);
        const y2 = center_y + radius * Math.sin(radians);
        lines.push({
            x1: center_x,
            y1: center_y,
            x2: x2,
            y2: y2,
        });
    }
    return lines;
}

export function draw_map(
    context,
    spots,
    colors,
    dims,
    transform,
    projection,
    night_displayed,
    show_equator,
) {
    const path_generator = d3.geoPath().projection(projection).context(context);

    // Clear the map before rendering
    context.clearRect(0, 0, dims.width, dims.height);

    context.save();

    // Clip the map content to the circle
    context.beginPath();
    context.arc(dims.center_x, dims.center_y, dims.radius, 0, 2 * Math.PI);
    context.clip();

    context.beginPath();
    context.arc(dims.center_x, dims.center_y, dims.radius, 0, 2 * Math.PI);
    context.fillStyle = colors.map.background;
    context.fill();

    apply_context_transform(context, transform);
    context.lineWidth = 1 / transform.k;

    generate_concentric_circles(dims.center_x, dims.center_y, dims.radius).forEach(circle => {
        context.beginPath();
        context.arc(circle.cx, circle.cy, circle.r, 0, 2 * Math.PI);
        context.strokeStyle = colors.map.graticule;
        context.stroke();
    });

    generate_radial_lines(dims.center_x, dims.center_y, dims.radius, 15).forEach(line => {
        context.beginPath();
        context.moveTo(line.x1, line.y1);
        context.lineTo(line.x2, line.y2);
        context.strokeStyle = colors.map.graticule;
        context.stroke();
    });

    // Render the map countries from geojson
    dxcc_map.features.forEach(feature => {
        context.beginPath();
        path_generator(feature);
        context.fillStyle = colors.map.land;
        context.strokeStyle = colors.map.land_borders;
        context.fill();
        context.stroke();
    });

    if (night_displayed) {
        draw_night_circle(context, { path_generator });
    }
    if (show_equator) {
        context.beginPath();
        context.strokeStyle = "rgb(0, 0, 0)";
        context.strokeWidth = 2;
        path_generator(d3.geoCircle().radius(90).center([0, 90])());
        context.stroke();
    }

    context.restore();

    // Map outline
    context.beginPath();
    context.arc(dims.center_x, dims.center_y, dims.radius, 0, 2 * Math.PI);
    context.stroke();

    context.beginPath();
    context.arc(dims.center_x, dims.center_y, 4, 0, 2 * Math.PI);
    context.fillStyle = "#FF0000";
    context.fill();
}

export function draw_spots(
    context,
    spots,
    colors,
    hovered_spot,
    pinned_spot,
    dims,
    dash_offset,
    transform,
    projection,
) {
    const path_generator = d3.geoPath().projection(projection).context(context);

    // Clear the map before rendering
    context.clearRect(0, 0, dims.width, dims.height);

    context.save();

    context.beginPath();
    context.arc(dims.center_x, dims.center_y, dims.radius, 0, 2 * Math.PI);
    context.clip();

    apply_context_transform(context, transform);

    let bold_spot;
    spots.forEach(spot => {
        if (hovered_spot.id == spot.id || pinned_spot == spot.id) {
            bold_spot = spot;
        } else {
            draw_spot(context, spot, colors, dash_offset, {
                is_bold: false,
                transform,
                path_generator,
                projection,
            });
        }
    });

    if (
        (bold_spot && hovered_spot.source === "dx") ||
        (bold_spot && pinned_spot === bold_spot.id && hovered_spot.source !== "dx")
    ) {
        const [center_lon, center_lat] = projection.rotate().map(x => -x);
        const azimuth = calculate_geographic_azimuth(
            center_lat,
            center_lon,
            bold_spot.dx_loc[1],
            bold_spot.dx_loc[0],
        );

        context.save();
        // Reset transform for drawing the azimuth line
        context.setTransform(1, 0, 0, 1, 0, 0);

        const angle = (90 - azimuth) * (Math.PI / 180);
        const x = dims.center_x + dims.radius * Math.cos(angle);
        const y = dims.center_y - dims.radius * Math.sin(angle);

        context.beginPath();
        context.moveTo(dims.center_x, dims.center_y);
        context.lineTo(x, y);
        context.strokeStyle = "black";
        context.lineWidth = 1;
        context.setLineDash([5, 5]);
        context.stroke();
        context.setLineDash([]);

        context.restore();
    }

    // Draw the bold spot last
    if (bold_spot != null) {
        draw_spot(context, bold_spot, colors, dash_offset, {
            is_bold: true,
            transform,
            path_generator,
            projection,
        });
    }

    context.restore();
}

export function draw_shadow_map(
    shadow_context,
    spots,
    dims,
    transform,
    projection,
    shadow_palette,
) {
    const shadow_path_generator = d3.geoPath().projection(projection).context(shadow_context);
    shadow_context.clearRect(0, 0, dims.width, dims.height);

    shadow_context.save();

    // Clip the map content to the circle
    shadow_context.beginPath();
    shadow_context.arc(dims.center_x, dims.center_y, dims.radius, 0, 2 * Math.PI);
    shadow_context.clip();

    apply_context_transform(shadow_context, transform);

    spots.forEach(spot => {
        draw_shadow_spot(shadow_context, spot, shadow_palette, {
            transform,
            path_generator: shadow_path_generator,
            projection,
        });
    });

    shadow_context.restore();
}

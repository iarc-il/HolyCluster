import * as d3 from "d3";
import { get_mode_shape } from "@/mode_shapes.js";
import { calculate_geographic_azimuth } from "@/utils.js";

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

function draw_spot_dx(context, spot, color, stroke_color, dx_x, dx_y, dx_size) {
    context.beginPath();
    context.strokeStyle = stroke_color;
    context.fillStyle = color;
    context.lineWidth = 1;
    const shape = get_mode_shape(spot.mode);
    if (shape === "square") {
        context.rect(dx_x - dx_size / 2, dx_y - dx_size / 2, dx_size, dx_size);
    } else if (shape === "triangle") {
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

function draw_spot(context, spot, colors, dash_offset, { is_bold, path_generator, projection }) {
    const line = build_geojson_line(spot);

    // Arc
    context.beginPath();
    if (is_bold) {
        context.strokeStyle = colors.light_bands[spot.band];
        context.lineWidth = 6;
    } else {
        context.strokeStyle = colors.bands[spot.band];
        context.lineWidth = 2;
    }
    if (spot.is_alerted) {
        context.setLineDash([10, 10]);
        context.lineDashOffset = dash_offset;
    } else {
        context.setLineDash([]);
    }
    path_generator(line);
    context.stroke();

    // DX marker
    const dx_size = is_bold ? 12 : 10;
    const [dx_x, dx_y] = projection(spot.dx_loc);

    draw_spot_dx(context, spot, colors.light_bands[spot.band], "grey", dx_x, dx_y, dx_size);

    // Spotter circle
    const [spotter_x, spotter_y] = projection(spot.spotter_loc);
    const spotter_radius = is_bold ? 5 : 3;

    context.beginPath();
    context.strokeStyle = "grey";
    context.fillStyle = colors.light_bands[spot.band];
    context.lineWidth = 1;
    context.arc(spotter_x, spotter_y, spotter_radius, 0, 2 * Math.PI);
    context.fill();
    context.stroke();
}

export function draw_spots(
    context,
    spots,
    colors,
    hovered_spot,
    pinned_spot,
    hovered_band,
    current_freq_spots,
    dims,
    dash_offset,
    projection,
) {
    const path_generator = d3.geoPath().projection(projection).context(context);

    context.save();

    context.beginPath();
    context.arc(dims.center_x, dims.center_y, dims.radius, 0, 2 * Math.PI);
    context.clip();

    let bold_spot;
    spots.forEach(spot => {
        const is_band_highlighted = hovered_band != null && spot.band === hovered_band;
        const is_freq_highlighted = current_freq_spots.includes(spot.id);
        if (hovered_spot.id == spot.id || pinned_spot == spot.id) {
            bold_spot = spot;
        } else if (is_band_highlighted || is_freq_highlighted) {
            draw_spot(context, spot, colors, dash_offset, {
                is_bold: true,
                path_generator,
                projection,
            });
        } else {
            draw_spot(context, spot, colors, dash_offset, {
                is_bold: false,
                path_generator,
                projection,
            });
        }
    });

    // Draw azimuth line before the bold spot so it appears under it
    if (bold_spot) {
        const show_azimuth =
            hovered_spot.source === "dx" ||
            (pinned_spot === bold_spot.id && hovered_spot.source !== "dx");

        if (show_azimuth) {
            const [center_lon, center_lat] = projection.rotate().map(x => -x);
            const azimuth = calculate_geographic_azimuth(
                center_lat,
                center_lon,
                bold_spot.dx_loc[1],
                bold_spot.dx_loc[0],
            );

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
        }
    }

    // Bold spot drawn last (on top)
    if (bold_spot != null) {
        draw_spot(context, bold_spot, colors, dash_offset, {
            is_bold: true,
            path_generator,
            projection,
        });
    }

    context.restore();
}

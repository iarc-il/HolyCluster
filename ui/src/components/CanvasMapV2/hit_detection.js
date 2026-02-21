import * as d3 from "d3";
import { get_mode_shape } from "@/mode_shapes.js";
import { build_geojson_line } from "./draw_spots.js";

const TYPE_OFFSET = { dx: 0, arc: 1, spotter: 2 };

function spot_to_color(spot_id, type) {
    const combined = spot_id * 3 + TYPE_OFFSET[type] + 1;
    const r = (combined >> 16) & 0xff;
    const g = (combined >> 8) & 0xff;
    const b = combined & 0xff;
    return `rgb(${r}, ${g}, ${b})`;
}

export function color_to_spot(r, g, b) {
    const combined = (r << 16) | (g << 8) | b;
    if (combined === 0) return null;
    const index = combined - 1;
    const spot_id = Math.floor(index / 3);
    const type_index = index % 3;
    const type = ["dx", "arc", "spotter"][type_index];
    return [type, spot_id];
}

function draw_shadow_dx(context, spot, color, dx_x, dx_y, dx_size) {
    context.beginPath();
    context.strokeStyle = color;
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

function draw_shadow_spot(context, spot, { path_generator, projection }) {
    const line = build_geojson_line(spot);

    context.beginPath();
    context.strokeStyle = spot_to_color(spot.id, "arc");
    context.lineWidth = 8;
    path_generator(line);
    context.stroke();

    const dx_size = 12;
    const [dx_x, dx_y] = projection(spot.dx_loc);
    const dx_color = spot_to_color(spot.id, "dx");
    draw_shadow_dx(context, spot, dx_color, dx_x, dx_y, dx_size);

    const [spotter_x, spotter_y] = projection(spot.spotter_loc);
    const spotter_radius = 7;

    context.beginPath();
    context.fillStyle = spot_to_color(spot.id, "spotter");
    context.lineWidth = 2;
    context.arc(spotter_x, spotter_y, spotter_radius, 0, 2 * Math.PI);
    context.fill();
}

export function draw_shadow_map(shadow_context, spots, dims, projection) {
    const shadow_path_generator = d3.geoPath().projection(projection).context(shadow_context);
    shadow_context.save();

    shadow_context.beginPath();
    shadow_context.arc(dims.center_x, dims.center_y, dims.radius, 0, 2 * Math.PI);
    shadow_context.clip();

    spots.forEach(spot => {
        draw_shadow_spot(shadow_context, spot, {
            path_generator: shadow_path_generator,
            projection,
        });
    });

    shadow_context.restore();
}

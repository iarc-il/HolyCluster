import * as d3 from "d3";
import simpleheat from "simpleheat";

const SNR_MIN_DB = -10;
const SNR_MAX_DB = 30;
const MIN_RADIUS_PX = 16;
const MAX_RADIUS_PX = 90;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function get_dpr() {
    return window.devicePixelRatio || 1;
}

function make_visibility_check(projection) {
    const rotation = projection.rotate();
    const center = [-rotation[0], -rotation[1]];
    return point => d3.geoDistance(center, point) <= Math.PI / 2;
}

function get_heat_intensity(value) {
    const snr = Number(value);
    if (!Number.isFinite(snr)) return null;
    return clamp((snr - SNR_MIN_DB) / (SNR_MAX_DB - SNR_MIN_DB), 0, 1);
}

function get_projected_spacing(projection, dims, step_deg) {
    const center = projection.invert([dims.center_x, dims.center_y]);
    if (!center) return 30;

    const [lon, lat] = center;
    const sample_a = projection([lon, clamp(lat, -80, 80)]);
    const sample_b = projection([lon + step_deg, clamp(lat, -80, 80)]);
    const sample_c = projection([lon, clamp(lat + step_deg, -80, 80)]);

    const distances = [];
    if (sample_a && sample_b) {
        distances.push(Math.hypot(sample_b[0] - sample_a[0], sample_b[1] - sample_a[1]));
    }
    if (sample_a && sample_c) {
        distances.push(Math.hypot(sample_c[0] - sample_a[0], sample_c[1] - sample_a[1]));
    }

    if (distances.length === 0) return 30;
    return Math.max(...distances);
}

function get_radius_px(projection, dims, step_deg) {
    const spacing = get_projected_spacing(projection, dims, step_deg);
    return clamp(spacing * 0.9, MIN_RADIUS_PX, MAX_RADIUS_PX);
}

export function draw_voacap(canvas, voacap, dims, projection, is_globe) {
    if (!canvas) return;

    const dpr = get_dpr();
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!voacap?.data?.cells?.length) return;

    const is_visible = is_globe ? make_visibility_check(projection) : () => true;
    const points = [];

    for (const cell of voacap.data.cells) {
        const intensity = get_heat_intensity(cell.value);
        if (intensity == null || intensity <= 0) continue;

        const lon_lat = [cell.lon, cell.lat];
        if (!is_visible(lon_lat)) continue;

        const projected = projection(lon_lat);
        if (!projected) continue;

        const [x, y] = projected;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        points.push([x * dpr, y * dpr, intensity]);
    }

    if (points.length === 0) return;

    const radius = get_radius_px(projection, dims, voacap.data.step_deg ?? 10) * dpr;
    const heat = simpleheat(canvas);
    heat.data(points);
    heat.max(1);
    heat.radius(radius, radius * 0.65);
    heat.gradient({
        0.05: "rgba(0, 0, 80, 0)",
        0.25: "blue",
        0.45: "cyan",
        0.65: "lime",
        0.82: "yellow",
        1.0: "red",
    });
    heat.draw(0.5);

    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath();
    ctx.arc(dims.center_x * dpr, dims.center_y * dpr, dims.radius * dpr, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fill();
    ctx.restore();
}

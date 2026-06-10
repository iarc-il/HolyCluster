import { draw_map, draw_zone_labels } from "./draw_map.js";
import { draw_spots } from "./draw_spots.js";
import { draw_voacap } from "./draw_voacap.js";
import { draw_shadow_map } from "./hit_detection.js";
import { profile_map } from "./map_profile.js";

export const DPR = window.devicePixelRatio || 1;

export function with_dpr(ctx, fn) {
    ctx.save();
    ctx.scale(DPR, DPR);
    fn(ctx);
    ctx.restore();
}

export function get_shadow_render_state(dims, projection, spots, is_globe, shadow_canvas) {
    return {
        canvas_height: shadow_canvas.height,
        canvas_width: shadow_canvas.width,
        center_x: dims.center_x,
        center_y: dims.center_y,
        height: dims.height,
        is_globe,
        radius: dims.radius,
        rotate: projection.rotate(),
        scale: projection.scale(),
        spots,
        translate: projection.translate(),
        width: dims.width,
    };
}

export function are_number_arrays_equal(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
        if (a[index] !== b[index]) return false;
    }
    return true;
}

export function is_same_shadow_render_state(a, b) {
    return (
        a != null &&
        b != null &&
        a.canvas_height === b.canvas_height &&
        a.canvas_width === b.canvas_width &&
        a.center_x === b.center_x &&
        a.center_y === b.center_y &&
        a.height === b.height &&
        a.is_globe === b.is_globe &&
        a.radius === b.radius &&
        a.scale === b.scale &&
        a.spots === b.spots &&
        a.width === b.width &&
        are_number_arrays_equal(a.rotate, b.rotate) &&
        are_number_arrays_equal(a.translate, b.translate)
    );
}

export function draw_shadow_layer(dims, projection, render_state_ref, canvas_refs) {
    const shadow_canvas = canvas_refs.shadow_canvas_ref.current;
    if (!shadow_canvas) return;

    const { spots, map_controls } = render_state_ref.current;
    const next_state = get_shadow_render_state(
        dims,
        projection,
        spots,
        map_controls.is_globe,
        shadow_canvas,
    );
    if (is_same_shadow_render_state(canvas_refs.shadow_render_state_ref.current, next_state)) {
        return;
    }

    const ctx = shadow_canvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, shadow_canvas.width, shadow_canvas.height);
    with_dpr(ctx, () => {
        profile_map("draw_shadow_map", () => {
            draw_shadow_map(ctx, spots, dims, projection, map_controls.is_globe);
        });
    });
    canvas_refs.shadow_render_state_ref.current = next_state;
}

export function do_redraw(
    dims,
    projection_ref,
    render_state_ref,
    canvas_refs,
    { skip_map = false, skip_shadow = false, fast = false } = {},
) {
    const profile_label = skip_map
        ? "do_redraw.overlay"
        : fast
          ? "do_redraw.fast"
          : "do_redraw.full";
    return profile_map(profile_label, () => {
        const projection = projection_ref.current;
        if (!dims || !projection) return;
        const {
            colors,
            map_controls,
            callsign_filters,
            settings,
            spots,
            hovered_spot,
            hovered_zone,
            hovered_dxcc,
            pinned_spot,
            hovered_band,
            current_freq_spots,
            night_time,
            voacap,
        } = render_state_ref.current;

        const render_dpr = fast && DPR > 1 ? 1 : DPR;

        const cache_canvas = canvas_refs.map_cache_canvas_ref.current;
        if (!skip_map && cache_canvas) {
            const target_w = dims.width * render_dpr;
            const target_h = dims.height * render_dpr;
            if (cache_canvas.width !== target_w || cache_canvas.height !== target_h) {
                cache_canvas.width = target_w;
                cache_canvas.height = target_h;
            }
            const cache_ctx = cache_canvas.getContext("2d");
            cache_ctx.clearRect(0, 0, cache_canvas.width, cache_canvas.height);
            cache_ctx.save();
            cache_ctx.scale(render_dpr, render_dpr);
            profile_map(fast ? "draw_map.fast" : "draw_map", () => {
                draw_map(
                    cache_ctx,
                    dims,
                    projection,
                    map_controls.night,
                    map_controls.show_equator,
                    map_controls.is_globe,
                    map_controls.show_cq_zones,
                    map_controls.show_itu_zones,
                    map_controls.show_us_states,
                    map_controls.show_can_states,
                    map_controls.show_maidenhead_grid,
                    callsign_filters,
                    colors.map,
                    colors.map_countries,
                    fast,
                    night_time,
                );
            });
            cache_ctx.restore();
        }

        const map_canvas = canvas_refs.map_canvas_ref.current;
        if (!skip_map && map_canvas && cache_canvas) {
            profile_map("blit_map_cache", () => {
                const ctx = map_canvas.getContext("2d");
                ctx.clearRect(0, 0, map_canvas.width, map_canvas.height);
                ctx.drawImage(
                    cache_canvas,
                    0,
                    0,
                    cache_canvas.width,
                    cache_canvas.height,
                    0,
                    0,
                    map_canvas.width,
                    map_canvas.height,
                );
            });
        }

        const spots_canvas = canvas_refs.spots_canvas_ref.current;
        if (spots_canvas) {
            const ctx = spots_canvas.getContext("2d");
            ctx.clearRect(0, 0, spots_canvas.width, spots_canvas.height);
            with_dpr(ctx, () => {
                profile_map("draw_spots", () => {
                    draw_spots(
                        ctx,
                        spots,
                        colors,
                        hovered_spot,
                        pinned_spot,
                        hovered_band,
                        current_freq_spots,
                        dims,
                        canvas_refs.dash_offset_ref.current,
                        projection,
                        map_controls.is_globe,
                        render_state_ref.current.home_location,
                    );
                });
                profile_map(fast ? "draw_zone_labels.fast" : "draw_zone_labels", () => {
                    draw_zone_labels(
                        ctx,
                        dims,
                        projection,
                        map_controls.is_globe,
                        map_controls.show_cq_zones,
                        map_controls.show_itu_zones,
                        map_controls.show_dxcc_labels,
                        map_controls.show_us_states,
                        map_controls.show_can_states,
                        map_controls.show_maidenhead_grid,
                        hovered_zone,
                        hovered_dxcc,
                        callsign_filters,
                        colors.map,
                        fast,
                    );
                });
            });
        }

        if (!skip_shadow) {
            draw_shadow_layer(dims, projection, render_state_ref, canvas_refs);
        }

        const voacap_canvas = canvas_refs.voacap_canvas_ref.current;
        if (voacap_canvas) {
            if (fast) {
                voacap_canvas
                    .getContext("2d")
                    .clearRect(0, 0, voacap_canvas.width, voacap_canvas.height);
            } else {
                profile_map("draw_voacap", () => {
                    draw_voacap(voacap_canvas, voacap, dims, projection, map_controls.is_globe);
                });
            }
        }
    });
}

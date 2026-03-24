import { useEffect, useRef, useState, useMemo } from "react";

import * as d3 from "d3";
import haversine from "haversine-distance";
import Maidenhead from "maidenhead";
import { useMeasure, useMediaQuery } from "@uidotdev/usehooks";

import { calculate_geographic_azimuth, km_to_miles, mod } from "@/utils.js";
import { Dimensions } from "./dimensions.js";
import { dxcc_map, draw_map } from "./draw_map.js";
import { draw_spots } from "./draw_spots.js";
import { color_to_spot, draw_shadow_map } from "./hit_detection.js";
import SpotPopup from "@/components/SpotPopup.jsx";
import MapAngles from "@/components/MapAngles.jsx";
import ToggleSVG from "@/components/ui/ToggleSVG";
import { useColors } from "@/hooks/useColors";
import { useSpotData } from "@/hooks/useSpotData";
import { useSpotInteraction } from "@/hooks/useSpotInteraction";
import { useSettings } from "@/hooks/useSettings";

const DPR = window.devicePixelRatio || 1;

function with_dpr(ctx, fn) {
    ctx.save();
    ctx.scale(DPR, DPR);
    fn(ctx);
    ctx.restore();
}

function do_redraw(
    dims,
    projection_ref,
    render_state_ref,
    canvas_refs,
    { skip_shadow = false } = {},
) {
    const projection = projection_ref.current;
    if (!dims || !projection) return;
    const {
        colors,
        map_controls,
        settings,
        spots,
        hovered_spot,
        pinned_spot,
        hovered_band,
        current_freq_spots,
    } = render_state_ref.current;

    // Map cache
    const cache_canvas = canvas_refs.map_cache_canvas_ref.current;
    if (cache_canvas) {
        const cache_ctx = cache_canvas.getContext("2d");
        cache_ctx.clearRect(0, 0, cache_canvas.width, cache_canvas.height);
        with_dpr(cache_ctx, () => {
            draw_map(
                cache_ctx,
                colors,
                dims,
                projection,
                map_controls.night,
                settings.show_equator,
                map_controls.is_globe,
            );
        });
    }

    // Blit map cache
    const map_canvas = canvas_refs.map_canvas_ref.current;
    if (map_canvas && cache_canvas) {
        const ctx = map_canvas.getContext("2d");
        ctx.clearRect(0, 0, map_canvas.width, map_canvas.height);
        ctx.drawImage(cache_canvas, 0, 0);
    }

    // Spots
    const spots_canvas = canvas_refs.spots_canvas_ref.current;
    if (spots_canvas) {
        const ctx = spots_canvas.getContext("2d");
        ctx.clearRect(0, 0, spots_canvas.width, spots_canvas.height);
        with_dpr(ctx, () => {
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
            );
        });
    }

    // Shadow (skip during drag for performance — only needed for hover hit detection)
    if (!skip_shadow) {
        const shadow_canvas = canvas_refs.shadow_canvas_ref.current;
        if (shadow_canvas) {
            const ctx = shadow_canvas.getContext("2d");
            ctx.clearRect(0, 0, shadow_canvas.width, shadow_canvas.height);
            with_dpr(ctx, () => {
                draw_shadow_map(ctx, spots, dims, projection, map_controls.is_globe);
            });
        }
    }
}

function CanvasMap({
    map_controls,
    set_map_controls,
    set_cat_to_spot,
    radius_in_km,
    set_radius_in_km,
    auto_radius,
    set_auto_radius,
}) {
    const { spots, current_freq_spots } = useSpotData();
    const { hovered_spot, set_hovered_spot, pinned_spot, set_pinned_spot, hovered_band } =
        useSpotInteraction();
    const { settings } = useSettings();
    const { colors } = useColors();

    const map_canvas_ref = useRef(null);
    const spots_canvas_ref = useRef(null);
    const shadow_canvas_ref = useRef(null);
    const map_cache_canvas_ref = useRef(null);
    const container_ref = useRef(null);

    const animation_id_ref = useRef(null);
    const dash_offset_ref = useRef(0);
    const zoom_settle_timer_ref = useRef(null);

    const projection_ref = useRef(null);
    const base_scale_ref = useRef(null);
    const gesture_active_ref = useRef(false);
    const callbacks_ref = useRef({});
    callbacks_ref.current = {
        set_map_controls,
        set_cat_to_spot,
        set_hovered_spot,
        set_pinned_spot,
    };

    const canvas_refs = {
        map_canvas_ref,
        spots_canvas_ref,
        shadow_canvas_ref,
        map_cache_canvas_ref,
        dash_offset_ref,
    };

    const [div_ref, { width, height }] = useMeasure();

    const is_max_xs_device = useMediaQuery("only screen and (max-width : 500px)");
    const is_sm_device = useMediaQuery("only screen and (min-width : 640px)");
    const inner_padding = is_sm_device ? 45 : 5;

    const dims = useMemo(
        () => (width && height ? new Dimensions(width, height, inner_padding) : null),
        [width, height, inner_padding],
    );

    const [center_lon, center_lat] = map_controls.location.location;
    const max_radius = 20000;

    const render_state_ref = useRef({});
    render_state_ref.current = {
        spots,
        colors,
        hovered_spot,
        pinned_spot,
        hovered_band,
        current_freq_spots,
        map_controls,
        settings,
        radius_in_km,
    };

    useMemo(() => {
        if (!dims) {
            projection_ref.current = null;
            base_scale_ref.current = null;
            return;
        }

        // During active gesture, only update scale — don't replace the projection
        // (replacing it resets the drag rotation and causes a flicker)
        if (gesture_active_ref.current && projection_ref.current && base_scale_ref.current) {
            projection_ref.current.scale((max_radius / radius_in_km) * base_scale_ref.current);
            return;
        }

        const proj = map_controls.is_globe
            ? d3.geoOrthographic().precision(0.1).clipAngle(90)
            : d3.geoAzimuthalEquidistant().precision(0.1);

        proj.fitSize(dims.padded_size, dxcc_map)
            .rotate([-center_lon, -center_lat, 0])
            .translate([dims.center_x, dims.center_y]);

        base_scale_ref.current = proj.scale();
        proj.scale((max_radius / radius_in_km) * proj.scale());
        projection_ref.current = proj;
    }, [dims, center_lon, center_lat, radius_in_km, map_controls.is_globe]);

    // Off-screen canvas setup (cache + shadow)
    useEffect(() => {
        if (!dims) return;

        const dpr_width = dims.width * DPR;
        const dpr_height = dims.height * DPR;

        if (!map_cache_canvas_ref.current) {
            map_cache_canvas_ref.current = document.createElement("canvas");
        }
        const cache_canvas = map_cache_canvas_ref.current;
        if (cache_canvas.width !== dpr_width || cache_canvas.height !== dpr_height) {
            cache_canvas.width = dpr_width;
            cache_canvas.height = dpr_height;
        }

        if (!shadow_canvas_ref.current) {
            shadow_canvas_ref.current = document.createElement("canvas");
        }
        const shadow_canvas = shadow_canvas_ref.current;
        if (shadow_canvas.width !== dpr_width || shadow_canvas.height !== dpr_height) {
            shadow_canvas.width = dpr_width;
            shadow_canvas.height = dpr_height;
        }
    }, [dims]);

    // Main rendering effect — redraws all canvases when any visual state changes
    useEffect(() => {
        if (!dims || !projection_ref.current) return;
        if (gesture_active_ref.current) return;
        do_redraw(dims, projection_ref, render_state_ref, canvas_refs);
    }, [
        dims,
        center_lon,
        center_lat,
        radius_in_km,
        spots,
        colors,
        hovered_spot,
        pinned_spot,
        hovered_band,
        current_freq_spots,
        map_controls.night,
        map_controls.is_globe,
        settings.show_equator,
    ]);

    // Animation loop for alerted spots
    useEffect(() => {
        if (!dims) return;

        function animate() {
            animation_id_ref.current = requestAnimationFrame(animate);

            if (gesture_active_ref.current) return;

            const rs = render_state_ref.current;
            if (!rs.spots.some(s => s.is_alerted)) return;

            dash_offset_ref.current -= 0.5;
            if (dash_offset_ref.current < -20) {
                dash_offset_ref.current = 0;
            }

            const spots_canvas = spots_canvas_ref.current;
            const projection = projection_ref.current;
            if (!spots_canvas || !projection) return;
            const ctx = spots_canvas.getContext("2d");
            ctx.clearRect(0, 0, spots_canvas.width, spots_canvas.height);
            with_dpr(ctx, () => {
                draw_spots(
                    ctx,
                    rs.spots,
                    rs.colors,
                    rs.hovered_spot,
                    rs.pinned_spot,
                    rs.hovered_band,
                    rs.current_freq_spots,
                    dims,
                    dash_offset_ref.current,
                    projection,
                    rs.map_controls.is_globe,
                );
            });
        }

        animation_id_ref.current = requestAnimationFrame(animate);

        return () => {
            if (animation_id_ref.current != null) {
                cancelAnimationFrame(animation_id_ref.current);
                animation_id_ref.current = null;
            }
        };
    }, [dims]);

    // Wheel zoom (desktop)
    useEffect(() => {
        if (!dims || !projection_ref.current) return;
        const container = container_ref.current;
        if (!container) return;

        let is_drawing = false;

        function on_wheel(event) {
            event.preventDefault();
            const projection = projection_ref.current;
            if (!projection) return;

            const zoom_factor = event.deltaY > 0 ? 0.9 : 1.1;
            const current_k = projection.scale() / base_scale_ref.current;
            const new_k = Math.max(1, Math.min(max_radius / 1000, current_k * zoom_factor));
            projection.scale(new_k * base_scale_ref.current);

            if (!is_drawing) {
                is_drawing = true;
                requestAnimationFrame(() => {
                    do_redraw(dims, projection_ref, render_state_ref, canvas_refs);
                    is_drawing = false;
                });
            }

            clearTimeout(zoom_settle_timer_ref.current);
            zoom_settle_timer_ref.current = setTimeout(() => {
                const zoom_radius = Math.round(max_radius / new_k / 100) * 100;
                set_auto_radius(false);
                set_radius_in_km(Math.max(zoom_radius, 100));
            }, 150);
        }

        container.addEventListener("wheel", on_wheel, { passive: false });

        return () => {
            clearTimeout(zoom_settle_timer_ref.current);
            container.removeEventListener("wheel", on_wheel);
        };
    }, [dims]);

    // Pointer interaction: drag, pinch-zoom, hover, tap, click
    useEffect(() => {
        if (!dims || !projection_ref.current) return;
        const container = container_ref.current;
        const shadow_canvas = shadow_canvas_ref.current;
        if (!container || !shadow_canvas) return;

        // Gesture state machine: idle | pending | dragging | pinching
        let gesture_state = "idle";
        function set_gesture(state) {
            gesture_state = state;
            gesture_active_ref.current = state === "dragging" || state === "pinching";
        }
        const pointers = new Map();

        // Drag state
        let rot_start = null;
        let drag_start = null;
        let current_rot = null;
        let last_drag_pos = null;
        let is_drawing = false;

        // Tap detection
        let pending_start_pos = null;
        let pending_start_time = null;

        // Pinch state
        let pinch_start_distance = null;
        let pinch_start_radius = null;

        const TAP_THRESHOLD_PX = 5;
        const TAP_THRESHOLD_MS = 300;

        function get_offset(event) {
            const rect = container.getBoundingClientRect();
            return { x: event.clientX - rect.left, y: event.clientY - rect.top };
        }

        function get_pointer_distance() {
            const pts = Array.from(pointers.values());
            if (pts.length < 2) return 0;
            const dx = pts[1].x - pts[0].x;
            const dy = pts[1].y - pts[0].y;
            return Math.sqrt(dx * dx + dy * dy);
        }

        function get_data_from_shadow_canvas(x, y) {
            const ctx = shadow_canvas.getContext("2d");
            const [r, g, b] = ctx.getImageData(x * DPR, y * DPR, 1, 1).data;
            const result = color_to_spot(r, g, b);
            if (result === null) return null;
            const [type, spot_id] = result;
            const { spots } = render_state_ref.current;
            if (!spots.some(s => s.id === spot_id)) return null;
            return [type, spot_id];
        }

        function perform_drag(x, y) {
            const projection = projection_ref.current;
            if (!projection || rot_start == null) return;
            const deg_per_px = 180 / (Math.PI * projection.scale());
            const dx = (x - drag_start[0]) * deg_per_px;
            const dy = (y - drag_start[1]) * deg_per_px;
            const new_lon = mod(rot_start[0] + dx + 180, 360) - 180;
            const new_lat = Math.max(-90, Math.min(90, rot_start[1] - dy));
            current_rot = [new_lon, new_lat, 0];

            projection.rotate(current_rot);
            if (!is_drawing) {
                is_drawing = true;
                requestAnimationFrame(() => {
                    // Re-apply drag rotation in case useMemo replaced the projection
                    const cur_proj = projection_ref.current;
                    if (cur_proj && current_rot) {
                        cur_proj.rotate(current_rot);
                    }
                    do_redraw(dims, projection_ref, render_state_ref, canvas_refs, {
                        skip_shadow: true,
                    });
                    is_drawing = false;
                });
            }
        }

        function perform_globe_drag(x, y) {
            const projection = projection_ref.current;
            if (!projection || !last_drag_pos) return;
            const scale = 360 / (2 * Math.PI * projection.scale());
            const dx = (x - last_drag_pos[0]) * scale;
            const dy = (y - last_drag_pos[1]) * scale;
            const cur = current_rot || projection.rotate();
            current_rot = [cur[0] + dx, Math.max(-90, Math.min(90, cur[1] - dy)), cur[2]];
            last_drag_pos = [x, y];

            projection.rotate(current_rot);
            if (!is_drawing) {
                is_drawing = true;
                requestAnimationFrame(() => {
                    const cur_proj = projection_ref.current;
                    if (cur_proj && current_rot) {
                        cur_proj.rotate(current_rot);
                    }
                    do_redraw(dims, projection_ref, render_state_ref, canvas_refs, {
                        skip_shadow: true,
                    });
                    is_drawing = false;
                });
            }
        }

        function finalize_drag() {
            do_redraw(dims, projection_ref, render_state_ref, canvas_refs);
            if (current_rot != null) {
                const final_lon = -current_rot[0];
                const final_lat = -current_rot[1];
                const displayed_locator = new Maidenhead(final_lat, final_lon).locator.slice(0, 6);
                callbacks_ref.current.set_map_controls(state => {
                    state.location = {
                        displayed_locator,
                        location: [final_lon, final_lat],
                    };
                });
            }
            rot_start = null;
            drag_start = null;
            current_rot = null;
            last_drag_pos = null;
        }

        function start_drag(x, y) {
            drag_start = [x, y];
            last_drag_pos = [x, y];
            const projection = projection_ref.current;
            if (projection) rot_start = projection.rotate();
        }

        function handle_tap(x, y, event) {
            const searched = get_data_from_shadow_canvas(x, y);
            if (event.pointerType === "mouse") {
                if (searched != null) {
                    const [, spot_id] = searched;
                    callbacks_ref.current.set_pinned_spot(spot_id);
                } else {
                    // Single click on empty area does nothing on mouse (double-click re-centers)
                }
            } else {
                // Touch: tap to pin/unpin
                const { pinned_spot: current_pinned } = render_state_ref.current;
                if (searched != null) {
                    const [, spot_id] = searched;
                    if (current_pinned === spot_id) {
                        callbacks_ref.current.set_pinned_spot(null);
                    } else {
                        callbacks_ref.current.set_pinned_spot(spot_id);
                    }
                } else {
                    if (current_pinned != null) {
                        callbacks_ref.current.set_pinned_spot(null);
                    }
                }
            }
        }

        function on_pointer_down(event) {
            // To allow clicking on the auto zoom toggle button
            if (event.target.tagName !== "CANVAS") return;
            const pos = get_offset(event);
            pointers.set(event.pointerId, pos);
            container.setPointerCapture(event.pointerId);

            if (pointers.size === 1) {
                // Single pointer — enter pending state
                set_gesture("pending");
                pending_start_pos = pos;
                pending_start_time = event.timeStamp;
            } else if (pointers.size === 2) {
                // Second pointer — enter pinch mode
                set_gesture("pinching");
                pending_start_pos = null;
                pending_start_time = null;
                pinch_start_distance = get_pointer_distance();
                pinch_start_radius = render_state_ref.current.radius_in_km;
            }
        }

        function on_pointer_move(event) {
            const pos = get_offset(event);
            pointers.set(event.pointerId, pos);

            // If no buttons are pressed but we're still dragging, the pointerup event was missed
            if (
                (gesture_state === "dragging" || gesture_state === "pending") &&
                event.buttons === 0
            ) {
                if (gesture_state === "dragging") {
                    finalize_drag();
                }
                pending_start_pos = null;
                pending_start_time = null;
                set_gesture("idle");
                return;
            }

            const is_globe = render_state_ref.current.map_controls.is_globe;
            const do_drag = is_globe ? perform_globe_drag : perform_drag;

            if (gesture_state === "pending") {
                const dx = pos.x - pending_start_pos.x;
                const dy = pos.y - pending_start_pos.y;
                if (Math.sqrt(dx * dx + dy * dy) > TAP_THRESHOLD_PX) {
                    set_gesture("dragging");
                    start_drag(pending_start_pos.x, pending_start_pos.y);
                    pending_start_pos = null;
                    pending_start_time = null;
                    do_drag(pos.x, pos.y);
                }
            } else if (gesture_state === "dragging") {
                do_drag(pos.x, pos.y);
            } else if (gesture_state === "pinching") {
                const new_distance = get_pointer_distance();
                if (pinch_start_distance > 0 && new_distance > 0) {
                    const scale_ratio = new_distance / pinch_start_distance;
                    const new_radius = Math.round(pinch_start_radius / scale_ratio / 100) * 100;
                    const clamped_radius = Math.max(100, Math.min(max_radius, new_radius));

                    const projection = projection_ref.current;
                    if (projection) {
                        const new_k = max_radius / clamped_radius;
                        projection.scale(new_k * base_scale_ref.current);
                        if (!is_drawing) {
                            is_drawing = true;
                            requestAnimationFrame(() => {
                                do_redraw(dims, projection_ref, render_state_ref, canvas_refs, {
                                    skip_shadow: true,
                                });
                                is_drawing = false;
                            });
                        }
                    }
                }
            }

            // Mouse hover (desktop only)
            if (event.pointerType === "mouse" && gesture_state !== "dragging") {
                const searched = get_data_from_shadow_canvas(pos.x, pos.y);
                const { hovered_spot: current_hovered } = render_state_ref.current;
                if (searched != null) {
                    const [type, spot_id] = searched;
                    if (current_hovered.source !== type || current_hovered.id !== spot_id) {
                        callbacks_ref.current.set_hovered_spot({ source: type, id: spot_id });
                    }
                } else {
                    if (current_hovered.source != null || current_hovered.id != null) {
                        callbacks_ref.current.set_hovered_spot({ source: null, id: null });
                    }
                }
            }
        }

        function on_pointer_up(event) {
            const was_state = gesture_state;
            pointers.delete(event.pointerId);

            if (was_state === "pending") {
                const elapsed = event.timeStamp - pending_start_time;
                if (elapsed < TAP_THRESHOLD_MS) {
                    handle_tap(pending_start_pos.x, pending_start_pos.y, event);
                }
                pending_start_pos = null;
                pending_start_time = null;
                set_gesture("idle");
            } else if (was_state === "dragging") {
                finalize_drag();
                set_gesture("idle");
            } else if (was_state === "pinching") {
                if (pointers.size === 1) {
                    // Transition pinching -> dragging with remaining pointer
                    const remaining = Array.from(pointers.values())[0];
                    start_drag(remaining.x, remaining.y);
                    // Settle the pinch zoom radius
                    const projection = projection_ref.current;
                    if (projection) {
                        const current_k = projection.scale() / base_scale_ref.current;
                        const zoom_radius = Math.round(max_radius / current_k / 100) * 100;
                        set_auto_radius(false);
                        set_radius_in_km(Math.max(zoom_radius, 100));
                    }
                    set_gesture("dragging");
                } else {
                    // Both pointers lifted — full redraw with shadow
                    const projection = projection_ref.current;
                    if (projection) {
                        const current_k = projection.scale() / base_scale_ref.current;
                        const zoom_radius = Math.round(max_radius / current_k / 100) * 100;
                        set_auto_radius(false);
                        set_radius_in_km(Math.max(zoom_radius, 100));
                    }
                    do_redraw(dims, projection_ref, render_state_ref, canvas_refs);
                    set_gesture("idle");
                }
                pinch_start_distance = null;
                pinch_start_radius = null;
            }
        }

        function on_pointer_leave(event) {
            pointers.delete(event.pointerId);
            if (event.pointerType === "mouse") {
                const { hovered_spot: current_hovered } = render_state_ref.current;
                if (current_hovered.source != null || current_hovered.id != null) {
                    callbacks_ref.current.set_hovered_spot({ source: null, id: null });
                }
            }
            if (pointers.size === 0) {
                if (gesture_state === "dragging") {
                    finalize_drag();
                }
                set_gesture("idle");
            }
        }

        // Desktop double-click (mouse only)
        function on_dblclick(event) {
            const pos = get_offset(event);
            const searched = get_data_from_shadow_canvas(pos.x, pos.y);
            if (searched != null) {
                const [, spot_id] = searched;
                const { spots } = render_state_ref.current;
                const spot = spots.find(s => s.id === spot_id);
                if (spot) callbacks_ref.current.set_cat_to_spot(spot);
            } else {
                const projection = projection_ref.current;
                if (!projection) return;
                const distance_from_center = Math.sqrt(
                    (dims.center_x - pos.x) ** 2 + (dims.center_y - pos.y) ** 2,
                );
                if (distance_from_center <= dims.radius) {
                    const inverted = projection.invert([pos.x, pos.y]);
                    if (!inverted) return;
                    const [lon, lat] = inverted;
                    const displayed_locator = new Maidenhead(lat, lon).locator.slice(0, 6);
                    callbacks_ref.current.set_map_controls(state => {
                        state.location = {
                            displayed_locator,
                            location: [lon, lat],
                        };
                    });
                }
            }
        }

        container.addEventListener("pointerdown", on_pointer_down);
        container.addEventListener("pointermove", on_pointer_move);
        container.addEventListener("pointerup", on_pointer_up);
        container.addEventListener("pointerleave", on_pointer_leave);
        container.addEventListener("pointercancel", on_pointer_leave);
        container.addEventListener("dblclick", on_dblclick);

        return () => {
            container.removeEventListener("pointerdown", on_pointer_down);
            container.removeEventListener("pointermove", on_pointer_move);
            container.removeEventListener("pointerup", on_pointer_up);
            container.removeEventListener("pointerleave", on_pointer_leave);
            container.removeEventListener("pointercancel", on_pointer_leave);
            container.removeEventListener("dblclick", on_dblclick);
        };
    }, [dims]);

    // Compute azimuth for hovered/pinned spot
    const hovered_spot_data = spots.find(spot => spot.id == hovered_spot.id);
    const pinned_spot_data = spots.find(spot => spot.id == pinned_spot);

    const hovered_spot_distance =
        hovered_spot_data != null
            ? (haversine(hovered_spot_data.dx_loc, hovered_spot_data.spotter_loc) / 1000).toFixed()
            : null;

    const pinned_spot_distance =
        pinned_spot_data != null
            ? (haversine(pinned_spot_data.dx_loc, pinned_spot_data.spotter_loc) / 1000).toFixed()
            : null;

    let azimuth = null;
    if (hovered_spot_data || pinned_spot_data) {
        const spot_data = hovered_spot_data || pinned_spot_data;
        azimuth = calculate_geographic_azimuth(
            center_lat,
            center_lon,
            spot_data.dx_loc[1],
            spot_data.dx_loc[0],
        );
    }

    const text_height = 20;
    const text_x = is_max_xs_device ? 10 : 20;
    const text_y = is_max_xs_device ? 20 : 30;

    const canvas_width = width ? width * DPR : 0;
    const canvas_height = height ? height * DPR : 0;
    const canvas_style = width && height ? { width: `${width}px`, height: `${height}px` } : {};

    return (
        <div
            ref={node => {
                container_ref.current = node;
                div_ref(node);
            }}
            className="relative h-full w-full"
            style={{
                backgroundColor: colors.theme.background,
                touchAction: "none",
                userSelect: "none",
            }}
        >
            <canvas
                className="absolute top-0 left-0"
                ref={map_canvas_ref}
                width={canvas_width}
                height={canvas_height}
                style={canvas_style}
            />
            <canvas
                className="absolute top-0 left-0"
                ref={spots_canvas_ref}
                width={canvas_width}
                height={canvas_height}
                style={canvas_style}
            />
            <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
                <g className="font-medium text-lg select-none">
                    <text x={text_x} y={text_y} fill={colors.theme.text}>
                        Radius: {settings.is_miles ? km_to_miles(radius_in_km) : radius_in_km}{" "}
                        {settings.is_miles ? "Miles" : "KM"} | Auto
                    </text>

                    <foreignObject
                        x={text_x + 215}
                        y={text_y - 18}
                        width="67"
                        height="40"
                        className="pointer-events-auto"
                    >
                        <div xmlns="http://www.w3.org/1999/xhtml">
                            <ToggleSVG
                                auto_radius={auto_radius}
                                set_auto_radius={set_auto_radius}
                            />
                        </div>
                    </foreignObject>

                    <text x={text_x} y={text_y + text_height} fill={colors.theme.text}>
                        Center: {map_controls.location.displayed_locator}
                    </text>

                    <text x={text_x} y={text_y + 2 * text_height} fill={colors.theme.text}>
                        Spots: {spots.length}
                    </text>
                </g>
                {dims && !map_controls.is_globe && (
                    <MapAngles
                        radius={dims.radius + 25 * dims.scale}
                        center_x={dims.center_x}
                        center_y={dims.center_y}
                        degrees_diff={15}
                        hovered_azimuth={azimuth}
                    />
                )}
            </svg>
            {(pinned_spot_data || hovered_spot_data) && (
                <SpotPopup
                    hovered_spot={hovered_spot}
                    set_hovered_spot={set_hovered_spot}
                    set_pinned_spot={set_pinned_spot}
                    hovered_spot_data={hovered_spot_data}
                    pinned_spot_data={pinned_spot_data}
                    distance={hovered_spot_distance ?? pinned_spot_distance}
                    azimuth={azimuth}
                />
            )}
        </div>
    );
}

export default CanvasMap;

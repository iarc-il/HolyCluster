import Maidenhead from "maidenhead";
import { useEffect, useRef } from "react";

import { mod } from "@/utils.js";
import { do_redraw } from "./render_helpers.js";

export function useMapGestures({
    dims,
    projection_ref,
    base_scale_ref,
    canvas_refs,
    render_state_ref,
    gesture_active_ref,
    hit_test_ref,
    set_auto_radius,
    set_radius_in_km,
    set_hovered_zone,
    set_hovered_dxcc,
    callbacks,
    max_radius,
}) {
    const container_ref = useRef(null);
    const zoom_settle_timer_ref = useRef(null);
    const last_gesture_draw_ref = useRef(0);

    const callbacks_ref = useRef({});
    callbacks_ref.current = callbacks;

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
        const shadow_canvas = canvas_refs.shadow_canvas_ref.current;
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
        const TARGET_GESTURE_FPS = 30;
        const GESTURE_FRAME_MS = 1000 / TARGET_GESTURE_FPS;

        // Tap detection
        let pending_start_pos = null;
        let pending_start_time = null;

        // Pinch state
        let pinch_start_distance = null;
        let pinch_start_radius = null;
        let suppress_tab_swipe = false;

        const TAP_THRESHOLD_PX = 5;
        const TAP_THRESHOLD_MS = 300;

        const { get_data_from_shadow_canvas, get_clickable_zone_label, get_clickable_dxcc_label } =
            hit_test_ref.current;

        function get_offset(event) {
            const rect = container.getBoundingClientRect();
            return { x: event.clientX - rect.left, y: event.clientY - rect.top };
        }

        function is_inside_map_circle(x, y) {
            const dx = x - dims.center_x;
            const dy = y - dims.center_y;
            const edge_buffer_px = 8;
            const interactive_radius = dims.radius + edge_buffer_px;
            return dx * dx + dy * dy <= interactive_radius * interactive_radius;
        }

        function get_pointer_distance() {
            const pts = Array.from(pointers.values());
            if (pts.length < 2) return 0;
            const dx = pts[1].x - pts[0].x;
            const dy = pts[1].y - pts[0].y;
            return Math.sqrt(dx * dx + dy * dy);
        }

        function update_label_hover(pos) {
            const clickable_zone = get_clickable_zone_label(pos.x, pos.y);
            const current_hovered_zone = render_state_ref.current.hovered_zone;
            if (
                current_hovered_zone.system !== clickable_zone?.system ||
                current_hovered_zone.number !== clickable_zone?.number
            ) {
                set_hovered_zone({
                    system: clickable_zone?.system ?? null,
                    number: clickable_zone?.number ?? null,
                });
            }

            const clickable_dxcc =
                clickable_zone == null ? get_clickable_dxcc_label(pos.x, pos.y) : null;
            const next_hovered_dxcc = clickable_dxcc
                ? {
                      feature_index: clickable_dxcc.feature_index,
                      label: clickable_dxcc.label,
                      entity: clickable_dxcc.entity,
                      x: clickable_dxcc.x,
                      y: clickable_dxcc.y,
                  }
                : null;
            const current_hovered_dxcc = render_state_ref.current.hovered_dxcc;
            if (
                current_hovered_dxcc?.feature_index !== next_hovered_dxcc?.feature_index ||
                current_hovered_dxcc?.label !== next_hovered_dxcc?.label ||
                current_hovered_dxcc?.entity !== next_hovered_dxcc?.entity ||
                current_hovered_dxcc?.x !== next_hovered_dxcc?.x ||
                current_hovered_dxcc?.y !== next_hovered_dxcc?.y
            ) {
                set_hovered_dxcc(next_hovered_dxcc);
            }
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
                    const cur_proj = projection_ref.current;
                    if (cur_proj && current_rot) {
                        cur_proj.rotate(current_rot);
                    }
                    if (!gesture_active_ref.current) {
                        is_drawing = false;
                        return;
                    }
                    const now = performance.now();
                    if (now - last_gesture_draw_ref.current < GESTURE_FRAME_MS) {
                        is_drawing = false;
                        return;
                    }
                    last_gesture_draw_ref.current = now;
                    do_redraw(dims, projection_ref, render_state_ref, canvas_refs, {
                        skip_shadow: true,
                        fast: true,
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
            let rot_x = cur[0] + dx;
            if (rot_x <= -180) {
                rot_x = 180;
            } else if (rot_x >= 180) {
                rot_x = -180;
            }
            const rot_y = Math.max(-90, Math.min(90, cur[1] - dy));
            current_rot = [rot_x, rot_y, cur[2]];
            last_drag_pos = [x, y];

            projection.rotate(current_rot);
            if (!is_drawing) {
                is_drawing = true;
                requestAnimationFrame(() => {
                    const cur_proj = projection_ref.current;
                    if (cur_proj && current_rot) {
                        cur_proj.rotate(current_rot);
                    }
                    if (!gesture_active_ref.current) {
                        is_drawing = false;
                        return;
                    }
                    const now = performance.now();
                    if (now - last_gesture_draw_ref.current < GESTURE_FRAME_MS) {
                        is_drawing = false;
                        return;
                    }
                    last_gesture_draw_ref.current = now;
                    do_redraw(dims, projection_ref, render_state_ref, canvas_refs, {
                        skip_shadow: true,
                        fast: true,
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
            const clickable_zone = get_clickable_zone_label(x, y);
            if (clickable_zone != null) {
                const { system, number } = clickable_zone;
                callbacks_ref.current.open_zone_context_menu(
                    event.clientX,
                    event.clientY,
                    system,
                    number,
                );
                return;
            }

            const clickable_dxcc = get_clickable_dxcc_label(x, y);
            if (clickable_dxcc?.entity) {
                callbacks_ref.current.open_dxcc_context_menu(
                    event.clientX,
                    event.clientY,
                    clickable_dxcc.entity,
                );
                return;
            }

            if (event.pointerType === "mouse") {
                if (searched != null) {
                    const [, spot_id] = searched;
                    callbacks_ref.current.set_pinned_spot(spot_id);
                }
            } else {
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
            if (event.target.tagName !== "CANVAS") return;
            const pos = get_offset(event);

            if (event.pointerType !== "mouse" && !is_inside_map_circle(pos.x, pos.y)) return;

            pointers.set(event.pointerId, pos);
            container.setPointerCapture(event.pointerId);

            if (pointers.size === 1) {
                set_gesture("pending");
                pending_start_pos = pos;
                pending_start_time = event.timeStamp;
            } else if (pointers.size === 2) {
                set_gesture("pinching");
                pending_start_pos = null;
                pending_start_time = null;
                pinch_start_distance = get_pointer_distance();
                pinch_start_radius = render_state_ref.current.radius_in_km;
            }
        }

        function on_touch_start_capture(event) {
            const touch = event.touches[0];
            if (!touch) return;
            const rect = container.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            suppress_tab_swipe = is_inside_map_circle(x, y);

            if (suppress_tab_swipe) {
                event.preventDefault();
                event.stopPropagation();
            }
        }

        function on_touch_move_capture(event) {
            if (!suppress_tab_swipe) return;
            event.preventDefault();
            event.stopPropagation();
        }

        function on_touch_end_capture(event) {
            if (!suppress_tab_swipe) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.touches.length === 0) {
                suppress_tab_swipe = false;
            }
        }

        function on_pointer_move(event) {
            const pos = get_offset(event);

            if (!pointers.has(event.pointerId)) {
                if (event.pointerType === "mouse" && gesture_state !== "dragging") {
                    update_label_hover(pos);

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
                return;
            }

            pointers.set(event.pointerId, pos);

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
                                if (!gesture_active_ref.current) {
                                    is_drawing = false;
                                    return;
                                }
                                const now = performance.now();
                                if (now - last_gesture_draw_ref.current < GESTURE_FRAME_MS) {
                                    is_drawing = false;
                                    return;
                                }
                                last_gesture_draw_ref.current = now;
                                do_redraw(dims, projection_ref, render_state_ref, canvas_refs, {
                                    skip_shadow: true,
                                    fast: true,
                                });
                                is_drawing = false;
                            });
                        }
                    }
                }
            }

            if (event.pointerType === "mouse" && gesture_state !== "dragging") {
                update_label_hover(pos);

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
                    const remaining = Array.from(pointers.values())[0];
                    start_drag(remaining.x, remaining.y);
                    const projection = projection_ref.current;
                    if (projection) {
                        const current_k = projection.scale() / base_scale_ref.current;
                        const zoom_radius = Math.round(max_radius / current_k / 100) * 100;
                        set_auto_radius(false);
                        set_radius_in_km(Math.max(zoom_radius, 100));
                    }
                    set_gesture("dragging");
                } else {
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
                const current_hovered_zone = render_state_ref.current.hovered_zone;
                if (current_hovered_zone.system != null || current_hovered_zone.number != null) {
                    set_hovered_zone({ system: null, number: null });
                }
                if (render_state_ref.current.hovered_dxcc != null) {
                    set_hovered_dxcc(null);
                }
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

        function on_dblclick(event) {
            const pos = get_offset(event);
            const searched = get_data_from_shadow_canvas(pos.x, pos.y);
            if (searched != null) {
                const [, spot_id] = searched;
                const { spots } = render_state_ref.current;
                const spot = spots.find(s => s.id === spot_id);
                if (spot) callbacks_ref.current.set_cat_to_spot(spot);
            }
        }

        container.addEventListener("pointerdown", on_pointer_down);
        container.addEventListener("pointermove", on_pointer_move);
        container.addEventListener("pointerup", on_pointer_up);
        container.addEventListener("pointerleave", on_pointer_leave);
        container.addEventListener("pointercancel", on_pointer_leave);
        container.addEventListener("dblclick", on_dblclick);
        container.addEventListener("touchstart", on_touch_start_capture, {
            capture: true,
            passive: false,
        });
        container.addEventListener("touchmove", on_touch_move_capture, {
            capture: true,
            passive: false,
        });
        container.addEventListener("touchend", on_touch_end_capture, {
            capture: true,
            passive: false,
        });
        container.addEventListener("touchcancel", on_touch_end_capture, {
            capture: true,
            passive: false,
        });

        return () => {
            container.removeEventListener("pointerdown", on_pointer_down);
            container.removeEventListener("pointermove", on_pointer_move);
            container.removeEventListener("pointerup", on_pointer_up);
            container.removeEventListener("pointerleave", on_pointer_leave);
            container.removeEventListener("pointercancel", on_pointer_leave);
            container.removeEventListener("dblclick", on_dblclick);
            container.removeEventListener("touchstart", on_touch_start_capture, true);
            container.removeEventListener("touchmove", on_touch_move_capture, true);
            container.removeEventListener("touchend", on_touch_end_capture, true);
            container.removeEventListener("touchcancel", on_touch_end_capture, true);
        };
    }, [dims]);

    return { container_ref, gesture_active_ref };
}

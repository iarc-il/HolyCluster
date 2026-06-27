import { useEffect } from "react";

import { get_hunter_alert_flash_phase } from "@/utils.js";
import { draw_zone_labels } from "./draw_map.js";
import { draw_spots } from "./draw_spots.js";
import { profile_map } from "./map_profile.js";
import { do_redraw, with_dpr } from "./render_helpers.js";

export function useMapRedraw({
    dims,
    projection_ref,
    canvas_refs,
    render_state_ref,
    gesture_active_ref,
    center_lon,
    center_lat,
    radius_in_km,
    map_controls,
    callsign_filters,
    colors,
    night_time_ms,
    spots,
    hovered_spot,
    pinned_spot,
    hovered_band,
    current_freq_spots,
    overlay_highlights_key,
    hovered_zone,
    hovered_dxcc,
    home_location,
    voacap_state,
    animation_id_ref,
}) {
    useEffect(() => {
        if (!dims || !projection_ref.current) return;
        if (gesture_active_ref.current) return;
        do_redraw(dims, projection_ref, render_state_ref, canvas_refs);
    }, [
        dims,
        center_lon,
        center_lat,
        radius_in_km,
        map_controls.night,
        map_controls.is_globe,
        map_controls.show_cq_zones,
        map_controls.show_itu_zones,
        map_controls.show_us_states,
        map_controls.show_can_states,
        map_controls.show_maidenhead_grid,
        callsign_filters.filters,
        callsign_filters.is_alert_filters_active,
        callsign_filters.is_show_only_filters_active,
        callsign_filters.is_hide_filters_active,
        overlay_highlights_key,
        map_controls.show_equator,
        colors.map,
        colors.map_countries,
        night_time_ms,
    ]);

    useEffect(() => {
        if (!dims || !projection_ref.current) return;
        if (!map_controls.night || night_time_ms != null) return;

        let timeout_id = null;

        function schedule_redraw() {
            const ms_until_next_minute = 60_000 - (Date.now() % 60_000);
            timeout_id = setTimeout(() => {
                if (!gesture_active_ref.current) {
                    do_redraw(dims, projection_ref, render_state_ref, canvas_refs);
                }
                schedule_redraw();
            }, ms_until_next_minute);
        }

        schedule_redraw();

        return () => {
            clearTimeout(timeout_id);
        };
    }, [dims, map_controls.night, night_time_ms]);

    useEffect(() => {
        if (!dims || !projection_ref.current) return;
        if (gesture_active_ref.current) return;
        do_redraw(dims, projection_ref, render_state_ref, canvas_refs, { skip_map: true });
    }, [
        dims,
        spots,
        colors,
        hovered_spot,
        pinned_spot,
        hovered_band,
        current_freq_spots,
        map_controls.show_dxcc_labels,
        map_controls.show_maidenhead_grid,
        hovered_zone.system,
        hovered_zone.number,
        hovered_dxcc?.feature_index,
        hovered_dxcc?.label,
        hovered_dxcc?.entity,
        home_location,
        map_controls.voacap_enabled,
        voacap_state.data,
        voacap_state.loading,
        voacap_state.stale,
    ]);

    useEffect(() => {
        if (!dims) return;

        function animate() {
            animation_id_ref.current = requestAnimationFrame(animate);

            if (gesture_active_ref.current) return;

            const rs = render_state_ref.current;
            if (!rs.spots.some(s => s.is_alerted || s.hunterNeeded?.is_needed)) return;

            const dash_offset_ref = canvas_refs.dash_offset_ref;
            dash_offset_ref.current -= 0.5;
            if (dash_offset_ref.current < -20) {
                dash_offset_ref.current = 0;
            }
            const hunter_flash_phase_ref = canvas_refs.hunter_flash_phase_ref;
            hunter_flash_phase_ref.current = get_hunter_alert_flash_phase();

            const spots_canvas = canvas_refs.spots_canvas_ref.current;
            const projection = projection_ref.current;
            if (!spots_canvas || !projection) return;
            const ctx = spots_canvas.getContext("2d");
            ctx.clearRect(0, 0, spots_canvas.width, spots_canvas.height);
            with_dpr(ctx, () => {
                profile_map("draw_spots.animation", () => {
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
                        rs.home_location,
                        hunter_flash_phase_ref.current,
                    );
                });
                profile_map("draw_zone_labels.animation", () => {
                    draw_zone_labels(
                        ctx,
                        dims,
                        projection,
                        rs.map_controls.is_globe,
                        rs.map_controls.show_cq_zones,
                        rs.map_controls.show_itu_zones,
                        rs.map_controls.show_dxcc_labels,
                        rs.map_controls.show_us_states,
                        rs.map_controls.show_can_states,
                        rs.map_controls.show_maidenhead_grid,
                        rs.hovered_zone,
                        rs.hovered_dxcc,
                        rs.callsign_filters,
                        rs.overlay_highlights,
                        rs.colors.map,
                    );
                });
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
}

import { find_zone_label_number, get_active_overlay_systems } from "@/utils/zones.js";
import { find_dxcc_label } from "./draw_map.js";
import { color_to_spot } from "./hit_detection.js";
import { profile_map } from "./map_profile.js";
import { DPR } from "./render_helpers.js";

export function useMapHitTest(shadow_canvas_ref, projection_ref, render_state_ref) {
    function get_data_from_shadow_canvas(x, y) {
        return profile_map("hit_test.shadow_canvas", () => {
            const shadow_canvas = shadow_canvas_ref.current;
            if (!shadow_canvas) return null;
            const ctx = shadow_canvas.getContext("2d", { willReadFrequently: true });
            const [r, g, b] = profile_map(
                "hit_test.getImageData",
                () => ctx.getImageData(x * DPR, y * DPR, 1, 1).data,
            );
            const result = color_to_spot(r, g, b);
            if (result === null) return null;
            const [type, spot_id] = result;
            const { spots } = render_state_ref.current;
            if (!spots.some(s => s.id === spot_id)) return null;
            return [type, spot_id];
        });
    }

    function get_clickable_zone_label(x, y) {
        return profile_map("hit_test.zone_labels", () => {
            const map_controls = render_state_ref.current.map_controls;
            const projection = projection_ref.current;
            if (!projection) return null;
            if (map_controls.show_maidenhead_grid) return null;

            const active_systems = get_active_overlay_systems(map_controls);
            for (const zone_system of active_systems) {
                const zone_number = find_zone_label_number(
                    zone_system,
                    projection,
                    x,
                    y,
                    map_controls.is_globe,
                );
                if (zone_number == null) continue;
                return { system: zone_system, number: zone_number };
            }

            return null;
        });
    }

    function get_clickable_dxcc_label(x, y) {
        return profile_map("hit_test.dxcc_labels", () => {
            const { map_controls } = render_state_ref.current;
            const projection = projection_ref.current;
            if (!projection) return null;
            if (map_controls.show_maidenhead_grid) return null;
            if (!map_controls.show_dxcc_labels) return null;

            const active_systems = get_active_overlay_systems(map_controls);
            if (active_systems.length !== 0) return null;

            return find_dxcc_label(projection, x, y, map_controls.is_globe);
        });
    }

    return {
        get_data_from_shadow_canvas,
        get_clickable_zone_label,
        get_clickable_dxcc_label,
    };
}

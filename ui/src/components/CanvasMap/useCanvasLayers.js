import { useEffect, useRef } from "react";

import { DPR } from "./render_helpers.js";

export function useCanvasLayers(dims) {
    const map_canvas_ref = useRef(null);
    const voacap_canvas_ref = useRef(null);
    const spots_canvas_ref = useRef(null);
    const shadow_canvas_ref = useRef(null);
    const map_cache_canvas_ref = useRef(null);
    const dash_offset_ref = useRef(0);
    const hunter_flash_phase_ref = useRef(0);
    const shadow_render_state_ref = useRef(null);

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

    const canvas_refs = {
        map_canvas_ref,
        voacap_canvas_ref,
        spots_canvas_ref,
        shadow_canvas_ref,
        map_cache_canvas_ref,
        dash_offset_ref,
        hunter_flash_phase_ref,
        shadow_render_state_ref,
    };

    return {
        map_canvas_ref,
        voacap_canvas_ref,
        spots_canvas_ref,
        shadow_canvas_ref,
        map_cache_canvas_ref,
        dash_offset_ref,
        hunter_flash_phase_ref,
        shadow_render_state_ref,
        canvas_refs,
    };
}

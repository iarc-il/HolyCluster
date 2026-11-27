import { annotateDiagnosticError } from "@/sentry.js";

function bounded_number(value) {
    return Number.isFinite(value) && value >= 0 ? value : null;
}

export function draw_heatmap(heatmap, alpha, kind, canvas, point_count, scale) {
    try {
        heatmap.draw(alpha);
    } catch (error) {
        try {
            annotateDiagnosticError(error, {
                operation: "heatmap_draw",
                heatmap_kind: ["activity", "voacap"].includes(kind) ? kind : "unknown",
                canvas_width: bounded_number(canvas?.width),
                canvas_height: bounded_number(canvas?.height),
                point_count:
                    Number.isSafeInteger(point_count) && point_count >= 0 ? point_count : null,
                render_scale: bounded_number(scale),
            });
        } catch {}
        throw error;
    }
}

import { prepareSentryEvent } from "@/sentry.js";
import { draw_heatmap } from "@/utils/draw_heatmap.js";
import { describe, expect, it } from "vitest";

function report(original) {
    return prepareSentryEvent(
        {
            exception: {
                values: [
                    {
                        type: "NonErrorThrown",
                        value: String(original),
                        mechanism: { type: "auto.function.react.error_boundary", handled: true },
                    },
                ],
            },
        },
        { originalException: original },
    );
}

describe("draw_heatmap", () => {
    it("preserves a non-Error canvas failure with bounded draw evidence", () => {
        const failure = {
            toString: () =>
                '[Exception... "Failure PRIVATE-CALLSIGN"  nsresult: "0x80004005 (NS_ERROR_FAILURE)" data: no]',
        };
        const heatmap = {
            draw() {
                throw failure;
            },
        };
        const canvas = { width: 400, height: 250 };

        let thrown;
        try {
            draw_heatmap(heatmap, 0.5, "voacap", canvas, 42, 2);
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBe(failure);
        const event = report(failure);
        expect(event.contexts.diagnostic).toMatchObject({
            operation: "heatmap_draw",
            heatmap_kind: "voacap",
            canvas_width: 400,
            canvas_height: 250,
            point_count: 42,
            render_scale: 2,
        });
        expect(JSON.stringify(event.contexts.diagnostic)).not.toContain("PRIVATE-CALLSIGN");
    });
});

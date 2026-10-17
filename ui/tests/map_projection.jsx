import { renderHook } from "@testing-library/react";
import * as d3 from "d3";
import { describe, expect, it } from "vitest";

import { create_dimensions } from "@/components/CanvasMap/dimensions.js";
import { useMapProjection } from "@/components/CanvasMap/useMapProjection.js";

const MAX_RADIUS_KM = 20000;

function render_projection(width, height, is_globe) {
    const dims = create_dimensions(width, height, 45);
    const gesture_active_ref = { current: false };
    const { result, unmount } = renderHook(() =>
        useMapProjection(dims, 0, 0, MAX_RADIUS_KM, is_globe, gesture_active_ref),
    );
    const projection = result.current.projection_ref.current;
    unmount();
    return { dims, projection };
}

describe("map projection", () => {
    it.each([
        [1000, 800],
        [800, 1000],
        [500, 500],
    ])("fits the fully zoomed-out map inside a %i by %i viewport", (width, height) => {
        const { dims, projection } = render_projection(width, height, false);
        const bounds = d3.geoPath(projection).bounds({ type: "Sphere" });

        expect(bounds[0][0]).toBeCloseTo(dims.center_x - dims.radius, 5);
        expect(bounds[0][1]).toBeCloseTo(dims.center_y - dims.radius, 5);
        expect(bounds[1][0]).toBeCloseTo(dims.center_x + dims.radius, 5);
        expect(bounds[1][1]).toBeCloseTo(dims.center_y + dims.radius, 5);
    });
});

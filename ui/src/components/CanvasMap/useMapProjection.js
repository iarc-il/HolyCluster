import * as d3 from "d3";
import { useMemo, useRef } from "react";

import { dxcc_map } from "./draw_map.js";

const MAX_RADIUS = 20000;

export function useMapProjection(
    dims,
    center_lon,
    center_lat,
    radius_in_km,
    is_globe,
    gesture_active_ref,
) {
    const projection_ref = useRef(null);
    const base_scale_ref = useRef(null);

    useMemo(() => {
        if (!dims) {
            projection_ref.current = null;
            base_scale_ref.current = null;
            return;
        }

        if (gesture_active_ref.current && projection_ref.current && base_scale_ref.current) {
            projection_ref.current.scale((MAX_RADIUS / radius_in_km) * base_scale_ref.current);
            return;
        }

        const proj = is_globe
            ? d3.geoOrthographic().precision(0.1).clipAngle(90)
            : d3.geoAzimuthalEquidistant().precision(0.1);

        proj.fitSize(dims.padded_size, dxcc_map)
            .rotate([-center_lon, -center_lat, 0])
            .translate([dims.center_x, dims.center_y]);

        base_scale_ref.current = proj.scale();
        proj.scale((MAX_RADIUS / radius_in_km) * proj.scale());
        projection_ref.current = proj;
    }, [dims, center_lon, center_lat, radius_in_km, is_globe]);

    return { projection_ref, base_scale_ref };
}

import { useEffect, useState, useRef } from "react";

import * as d3 from "d3";
import haversine from "haversine-distance";
import Maidenhead from "maidenhead";
import { useMeasure, useMediaQuery } from "@uidotdev/usehooks";

import { mod, calculate_geographic_azimuth, km_to_miles } from "@/utils.js";
import {
    build_geojson_line,
    dxcc_map,
    apply_context_transform,
    draw_map,
    draw_spots,
    draw_shadow_map,
    Dimensions,
} from "./draw_map.js";
import SpotPopup from "@/components/SpotPopup.jsx";
import MapAngles from "@/components/MapAngles.jsx";
import ToggleSVG from "@/components/ToggleSVG";
import { useColors } from "@/hooks/useColors";
import { useServerData } from "@/hooks/useServerData";
import { useSettings } from "@/hooks/useSettings";

export const ENABLE_PANNING = false;

function apply_zoom_and_drag_behaviors(
    context,
    {
        zoom_transform,
        set_map_controls,
        width,
        height,
        draw_map_inner,
        projection,
        canvas,
        center_lat,
    },
) {
    let is_drawing = false;
    let lon_start = null;
    let current_lon = null;
    let drag_start = null;
    let last_transform = zoom_transform.current;

    const zoom = d3
        .zoom()
        .scaleExtent([1, 20])
        .translateExtent([
            [0, 0],
            [width, height],
        ])
        .on("zoom", event => {
            if (!is_drawing) {
                is_drawing = true;
                requestAnimationFrame(() => {
                    context.clearRect(0, 0, width, height);

                    if (last_transform.k > 1 && event.transform.k === 1) {
                        event.transform.x = 0;
                        event.transform.y = 0;
                    }

                    if (!ENABLE_PANNING && event.transform.k > 1) {
                        const centerOffsetX = (width / 2) * (1 - event.transform.k);
                        const centerOffsetY = (height / 2) * (1 - event.transform.k);
                        event.transform.x = centerOffsetX;
                        event.transform.y = centerOffsetY;
                    }

                    zoom_transform.current = event.transform;
                    last_transform = event.transform;
                    draw_map_inner(zoom_transform.current);
                    is_drawing = false;
                });
            }
        });

    const drag = d3
        .drag()
        .on("start", event => {
            drag_start = [event.x, event.y];
            lon_start = projection.rotate()[0];
        })
        .on("drag", event => {
            if (zoom_transform.current.k > 1 && !ENABLE_PANNING) {
                const dx = event.dx / zoom_transform.current.k;
                const dy = event.dy / zoom_transform.current.k;

                zoom_transform.current = zoom_transform.current.translate(dx, dy);

                const selection = d3.select(canvas);
                const transform = zoom_transform.current;
                const newCenter = [
                    (width / 2 - transform.x) / transform.k,
                    (height / 2 - transform.y) / transform.k,
                ];
                zoom.translateTo(selection, newCenter[0], newCenter[1]);
            } else {
                const dx = (event.x - drag_start[0]) / zoom_transform.current.k;
                current_lon = mod(lon_start + dx + 180, 360) - 180;

                const current_rotation = projection.rotate();
                projection.rotate([current_lon, current_rotation[1], current_rotation[2]]);

                zoom_transform.current.x = 0;
                zoom_transform.current.y = 0;
            }

            if (!is_drawing) {
                is_drawing = true;
                requestAnimationFrame(() => {
                    context.clearRect(0, 0, width, height);
                    draw_map_inner(zoom_transform.current);
                    is_drawing = false;
                });
            }
        })
        .on("end", event => {
            if (zoom_transform.current.k === 1) {
                const displayed_locator = new Maidenhead(center_lat, -current_lon).locator.slice(
                    0,
                    6,
                );
                set_map_controls(state => {
                    state.location = {
                        displayed_locator: displayed_locator,
                        location: [-current_lon, center_lat],
                    };
                });
            }
        });

    const selection = d3.select(canvas).call(drag).call(zoom);
    zoom.translateTo(selection, width / 2, height / 2);
    zoom.transform(selection, zoom_transform.current);
}

function color_to_spot(r, g, b) {
    const combined = (r << 16) | (g << 8) | b;
    if (combined === 0) return null;
    const index = combined - 1;
    const spot_id = Math.floor(index / 3);
    const type_index = index % 3;
    const type = ["dx", "arc", "spotter"][type_index];
    return [type, spot_id];
}

function build_canvas_storage(projection, canvas_map) {
    return Object.fromEntries(
        Object.entries(canvas_map).map(([key, canvas_ref]) => {
            const canvas = canvas_ref.current;
            const context = canvas?.getContext("2d");
            return [key, { canvas, context }];
        }),
    );
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
    const { spots, hovered_spot, set_hovered_spot, pinned_spot, set_pinned_spot } = useServerData();
    const { settings } = useSettings();

    const map_canvas_ref = useRef(null);
    const spots_canvas_ref = useRef(null);
    const shadow_canvas_ref = useRef(null);

    const animation_id_ref = useRef(null);
    const dash_offset_ref = useRef(0);

    const [div_ref, { width, height }] = useMeasure();
    const dims = new Dimensions(width, height, 50);

    const zoom_transform = useRef(d3.zoomIdentity);

    const [center_lon, center_lat] = map_controls.location.location;

    const { colors } = useColors();

    const is_max_xs_device = useMediaQuery("only screen and (max-width : 500px)");
    const text_height = 20;
    const text_x = is_max_xs_device ? 10 : 20;
    const text_y = is_max_xs_device ? 20 : 30;

    const projection = d3
        .geoAzimuthalEquidistant()
        .precision(0.1)
        .fitSize(dims.padded_size, dxcc_map)
        .rotate([-center_lon, -center_lat, 0])
        .translate([dims.center_x, dims.center_y]);

    const canvas_storage = build_canvas_storage(projection, {
        map: map_canvas_ref,
        spots: spots_canvas_ref,
        shadow: shadow_canvas_ref,
    });

    useEffect(() => {
        if (dims.width == null || dims.height == null) {
            return;
        }

        function draw_spots_inner(transform) {
            draw_spots(
                canvas_storage.spots.context,
                spots,
                colors,
                hovered_spot,
                pinned_spot,
                dims,
                dash_offset_ref.current,
                transform,
                projection,
            );

            // This recursion redraws the spot every frame with changing sash_offset to animate the alerted spots.
            dash_offset_ref.current -= 0.5;
            if (dash_offset_ref.current < -20) {
                dash_offset_ref.current = 0;
            }
            animation_id_ref.current = requestAnimationFrame(() => draw_spots_inner(transform));
        }

        function draw_map_inner(transform) {
            draw_map(
                canvas_storage.map.context,
                spots,
                colors,
                dims,
                transform,
                projection,
                map_controls.night,
                settings.show_equator,
            );
            if (animation_id_ref.current != null) {
                cancelAnimationFrame(animation_id_ref.current);
            }
            draw_spots_inner(transform);
            draw_shadow_map(canvas_storage.shadow.context, spots, dims, transform, projection);
        }

        draw_map_inner(zoom_transform.current);

        apply_zoom_and_drag_behaviors(canvas_storage.map.context, {
            zoom_transform,
            set_map_controls,
            width,
            height,
            draw_map_inner,
            projection,
            canvas: shadow_canvas_ref.current,
            center_lat,
        });

        function get_data_from_shadow_canvas(x, y) {
            const [r, g, b] = canvas_storage.shadow.context.getImageData(x, y, 1, 1).data;
            const result = color_to_spot(r, g, b);
            if (result === null) {
                return null;
            };
            const [type, spot_id] = result;
            if (!spots.some(s => s.id === spot_id)) {
                return null;
            };
            return [type, spot_id];
        }

        function on_mouse_move(event) {
            const { offsetX, offsetY } = event;
            const searched = get_data_from_shadow_canvas(offsetX, offsetY);
            if (searched != null) {
                let [type, spot_id] = searched;
                if (hovered_spot.source != "map" || hovered_spot.id != spot_id) {
                    set_hovered_spot({ source: type, id: spot_id });
                }
            } else {
                if (hovered_spot.source != null || hovered_spot.id != null) {
                    set_hovered_spot({ source: null, id: null });
                }
            }
        }

        function on_click(event) {
            const { offsetX, offsetY } = event;
            const searched = get_data_from_shadow_canvas(offsetX, offsetY);
            if (searched != null) {
                let [type, spot_id] = searched;
                switch (event.detail) {
                    case 1:
                        set_pinned_spot(spot_id);
                        break;
                    case 2:
                        const spot = spots.find(spot => spot.id == spot_id);
                        set_cat_to_spot(spot);
                        break;
                }
            }
        }

        // Add event listener for mousemove
        canvas_storage.shadow.canvas.addEventListener("mousemove", on_mouse_move);
        canvas_storage.shadow.canvas.addEventListener("click", on_click);

        return () => {
            canvas_storage.shadow.canvas.removeEventListener("mousemove", on_mouse_move);
            canvas_storage.shadow.canvas.removeEventListener("click", on_click);
            cancelAnimationFrame(animation_id_ref.current);
        };
    }, [spots, center_lon, center_lat, hovered_spot, width, height, map_controls]);

    const hovered_spot_data = spots.find(spot => spot.id == hovered_spot.id);
    const pinned_spot_data = spots.find(spot => spot.id == pinned_spot);

    const hovered_spot_distance =
        hovered_spot_data != null
            ? (haversine(hovered_spot_data.dx_loc, hovered_spot_data.spotter_loc) / 1000).toFixed()
            : "";

    const pinned_spot_distance =
        hovered_spot_data != null
            ? (haversine(hovered_spot_data.dx_loc, hovered_spot_data.spotter_loc) / 1000).toFixed()
            : "";

    let azimuth = null;
    if (
        (hovered_spot_data && hovered_spot.source === "dx") ||
        (spots.find(spot => spot.id === pinned_spot) && hovered_spot.source !== "dx")
    ) {
        const spot_data = hovered_spot_data || spots.find(spot => spot.id === pinned_spot);
        const [center_lon, center_lat] = projection.rotate().map(x => -x);
        azimuth = calculate_geographic_azimuth(
            center_lat,
            center_lon,
            spot_data.dx_loc[1],
            spot_data.dx_loc[0],
        );
    }

    return (
        <div
            ref={div_ref}
            className="relative h-full w-full"
            style={{ backgroundColor: colors.theme.background }}
        >
            <canvas
                className="absolute top-0 left-0"
                ref={map_canvas_ref}
                width={width}
                height={height}
            />
            <canvas
                className="absolute top-0 left-0"
                ref={spots_canvas_ref}
                width={width}
                height={height}
            />
            <canvas
                className="opacity-0 absolute top-0 left-0 none"
                ref={shadow_canvas_ref}
                width={width}
                height={height}
            />
            <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
                <g className="font-medium text-lg select-none">
                    <text x={text_x} y={text_y} fill={colors.theme.text}>
                        Radius: {settings.is_miles ? km_to_miles(radius_in_km) : radius_in_km}{" "}
                        {settings.is_miles ? "Miles" : "KM"} | Auto
                    </text>

                    <foreignObject x={text_x + 215} y={text_y - 18} width="67" height="40">
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
                <MapAngles
                    radius={dims.radius + 25 * dims.scale}
                    center_x={dims.center_x}
                    center_y={dims.center_y}
                    degrees_diff={15}
                    hovered_azimuth={azimuth}
                />
            </svg>
            {pinned_spot_data || hovered_spot_data ? (
                <SpotPopup
                    hovered_spot={hovered_spot}
                    set_hovered_spot={set_hovered_spot}
                    set_pinned_spot={set_pinned_spot}
                    hovered_spot_data={hovered_spot_data}
                    pinned_spot_data={pinned_spot_data}
                    distance={hovered_spot_distance ?? pinned_spot_distance}
                    azimuth={azimuth}
                />
            ) : (
                ""
            )}
        </div>
    );
}

export default CanvasMap;

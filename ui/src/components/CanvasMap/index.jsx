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

function do_redraw(dims, projection_ref, render_state_ref, canvas_refs) {
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
            );
        });
    }

    // Shadow
    const shadow_canvas = canvas_refs.shadow_canvas_ref.current;
    if (shadow_canvas) {
        const ctx = shadow_canvas.getContext("2d");
        ctx.clearRect(0, 0, shadow_canvas.width, shadow_canvas.height);
        with_dpr(ctx, () => {
            draw_shadow_map(ctx, spots, dims, projection);
        });
    }
}

function CanvasMapV2({
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

    const animation_id_ref = useRef(null);
    const dash_offset_ref = useRef(0);
    const zoom_settle_timer_ref = useRef(null);

    const projection_ref = useRef(null);
    const base_scale_ref = useRef(null);

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
    };

    useMemo(() => {
        if (!dims) {
            projection_ref.current = null;
            base_scale_ref.current = null;
            return;
        }
        const proj = d3
            .geoAzimuthalEquidistant()
            .precision(0.1)
            .fitSize(dims.padded_size, dxcc_map)
            .rotate([-center_lon, -center_lat, 0])
            .translate([dims.center_x, dims.center_y]);

        base_scale_ref.current = proj.scale();
        proj.scale((max_radius / radius_in_km) * proj.scale());
        projection_ref.current = proj;
    }, [dims, center_lon, center_lat, radius_in_km]);

    // Cache canvas setup
    useEffect(() => {
        if (!dims) return;

        if (!map_cache_canvas_ref.current) {
            map_cache_canvas_ref.current = document.createElement("canvas");
        }
        const cache_canvas = map_cache_canvas_ref.current;
        const dpr_width = dims.width * DPR;
        const dpr_height = dims.height * DPR;
        if (cache_canvas.width !== dpr_width || cache_canvas.height !== dpr_height) {
            cache_canvas.width = dpr_width;
            cache_canvas.height = dpr_height;
        }
    }, [dims]);

    // Main rendering effect — redraws all canvases when any visual state changes
    useEffect(() => {
        if (!dims || !projection_ref.current) return;
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
        settings.show_equator,
    ]);

    // Animation loop for alerted spots
    useEffect(() => {
        if (!dims || !projection_ref.current) return;

        const has_alerted = spots.some(s => s.is_alerted);
        if (!has_alerted) return;

        function animate() {
            dash_offset_ref.current -= 0.5;
            if (dash_offset_ref.current < -20) {
                dash_offset_ref.current = 0;
            }

            const spots_canvas = spots_canvas_ref.current;
            const projection = projection_ref.current;
            if (!spots_canvas || !projection) return;
            const ctx = spots_canvas.getContext("2d");
            ctx.clearRect(0, 0, spots_canvas.width, spots_canvas.height);
            const rs = render_state_ref.current;
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
                );
            });

            animation_id_ref.current = requestAnimationFrame(animate);
        }

        animation_id_ref.current = requestAnimationFrame(animate);

        return () => {
            if (animation_id_ref.current != null) {
                cancelAnimationFrame(animation_id_ref.current);
                animation_id_ref.current = null;
            }
        };
    }, [dims, center_lon, center_lat, radius_in_km, spots]);

    // Zoom behavior
    useEffect(() => {
        if (!dims || !projection_ref.current) return;
        const shadow_canvas = shadow_canvas_ref.current;
        if (!shadow_canvas) return;

        const selection = d3.select(shadow_canvas);
        let is_drawing = false;

        const zoom = d3
            .zoom()
            .scaleExtent([1, max_radius / 1000])
            .filter(event => {
                return (
                    event.type === "wheel" ||
                    event.type === "touchstart" ||
                    event.type === "touchmove"
                );
            })
            .on("zoom", event => {
                if (!event.sourceEvent) return;

                const k = event.transform.k;
                const projection = projection_ref.current;
                if (!projection) return;
                projection.scale(k * base_scale_ref.current);

                if (!is_drawing) {
                    is_drawing = true;
                    requestAnimationFrame(() => {
                        do_redraw(dims, projection_ref, render_state_ref, canvas_refs);
                        is_drawing = false;
                    });
                }

                clearTimeout(zoom_settle_timer_ref.current);
                zoom_settle_timer_ref.current = setTimeout(() => {
                    const zoom_radius = Math.round(max_radius / k / 100) * 100;
                    set_auto_radius(false);
                    set_radius_in_km(Math.max(zoom_radius, 100));
                }, 150);
            });

        // Sync d3 zoom to current radius
        const k_from_radius = max_radius / radius_in_km;
        selection.call(zoom);
        selection.call(zoom.transform, d3.zoomIdentity.scale(k_from_radius));

        return () => {
            clearTimeout(zoom_settle_timer_ref.current);
            selection.on(".zoom", null);
        };
    }, [dims, radius_in_km]);

    // Drag behavior
    useEffect(() => {
        if (!dims || !projection_ref.current) return;
        const shadow_canvas = shadow_canvas_ref.current;
        if (!shadow_canvas) return;

        let lon_start = null;
        let drag_start = null;
        let current_lon = null;

        const drag = d3
            .drag()
            .filter(event => {
                return event.button === 0 && !event.ctrlKey && !event.metaKey;
            })
            .on("start", event => {
                drag_start = [event.x, event.y];
                const projection = projection_ref.current;
                if (projection) lon_start = projection.rotate()[0];
            })
            .on("drag", event => {
                const projection = projection_ref.current;
                if (!projection || lon_start == null) return;
                const scale_factor = base_scale_ref.current
                    ? projection.scale() / base_scale_ref.current
                    : 1;
                const dx = (event.x - drag_start[0]) / scale_factor;
                current_lon = mod(lon_start + dx + 180, 360) - 180;

                projection.rotate([current_lon, -center_lat, 0]);
                do_redraw(dims, projection_ref, render_state_ref, canvas_refs);
            })
            .on("end", () => {
                if (current_lon != null) {
                    const final_lon = -current_lon;
                    const displayed_locator = new Maidenhead(center_lat, final_lon).locator.slice(
                        0,
                        6,
                    );
                    set_map_controls(state => {
                        state.location = {
                            displayed_locator,
                            location: [final_lon, center_lat],
                        };
                    });
                }
            });

        const selection = d3.select(shadow_canvas);
        selection.call(drag);

        return () => {
            selection.on(".drag", null);
        };
    }, [dims, center_lat, set_map_controls]);

    // Mouse interaction: hover and click
    useEffect(() => {
        if (!dims || !projection_ref.current) return;
        const shadow_canvas = shadow_canvas_ref.current;
        if (!shadow_canvas) return;

        function get_data_from_shadow_canvas(x, y) {
            const ctx = shadow_canvas.getContext("2d");
            const [r, g, b] = ctx.getImageData(x * DPR, y * DPR, 1, 1).data;
            const result = color_to_spot(r, g, b);
            if (result === null) return null;
            const [type, spot_id] = result;
            if (!spots.some(s => s.id === spot_id)) return null;
            return [type, spot_id];
        }

        function on_mouse_move(event) {
            const { offsetX, offsetY } = event;
            const searched = get_data_from_shadow_canvas(offsetX, offsetY);
            if (searched != null) {
                const [type, spot_id] = searched;
                if (hovered_spot.source !== type || hovered_spot.id !== spot_id) {
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
                const [, spot_id] = searched;
                if (event.detail === 1) {
                    set_pinned_spot(spot_id);
                } else if (event.detail === 2) {
                    const spot = spots.find(s => s.id === spot_id);
                    if (spot) set_cat_to_spot(spot);
                }
            } else if (event.detail === 2) {
                const projection = projection_ref.current;
                if (!projection) return;
                const distance_from_center = Math.sqrt(
                    (dims.center_x - offsetX) ** 2 + (dims.center_y - offsetY) ** 2,
                );
                if (distance_from_center <= dims.radius) {
                    const inverted = projection.invert([offsetX, offsetY]);
                    if (!inverted) return;
                    const [lon, lat] = inverted;
                    const displayed_locator = new Maidenhead(lat, lon).locator.slice(0, 6);
                    set_map_controls(state => {
                        state.location = {
                            displayed_locator,
                            location: [lon, lat],
                        };
                    });
                }
            }
        }

        function on_mouse_leave() {
            if (hovered_spot.source != null || hovered_spot.id != null) {
                set_hovered_spot({ source: null, id: null });
            }
        }

        shadow_canvas.addEventListener("mousemove", on_mouse_move);
        shadow_canvas.addEventListener("click", on_click);
        shadow_canvas.addEventListener("mouseleave", on_mouse_leave);

        return () => {
            shadow_canvas.removeEventListener("mousemove", on_mouse_move);
            shadow_canvas.removeEventListener("click", on_click);
            shadow_canvas.removeEventListener("mouseleave", on_mouse_leave);
        };
    }, [
        dims,
        spots,
        hovered_spot,
        set_hovered_spot,
        set_pinned_spot,
        set_cat_to_spot,
        set_map_controls,
    ]);

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
            ref={div_ref}
            className="relative h-full w-full"
            style={{ backgroundColor: colors.theme.background }}
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
            <canvas
                className="opacity-0 absolute top-0 left-0"
                ref={shadow_canvas_ref}
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
                {dims && (
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

export default CanvasMapV2;

import { useRef, useState, useEffect } from "react";
import { useMeasure, useMediaQuery } from "@uidotdev/usehooks";

import * as d3 from "d3";
import haversine from "haversine-distance";
import Maidenhead from "maidenhead";
import geojsonRewind from "@mapbox/geojson-rewind";
import { century, equationOfTime, declination } from "solar-calculator";

import dxcc_map_raw from "@/assets/dxcc_map.json";
import MapAngles from "@/components/MapAngles.jsx";
import Spot from "@/components/Spot/index.jsx";
import SpotPopup from "@/components/SpotPopup.jsx";
import { km_to_miles, calculate_geographic_azimuth } from "@/utils.js";
import { useColors } from "@/hooks/useColors";
import { useSettings } from "@/hooks/useSettings";
import ToggleSVG from "./ToggleSVG";

import { useServerData } from "@/hooks/useServerData";

const dxcc_map = geojsonRewind(dxcc_map_raw, true);

const map_angles_diff = 15;

function generate_radial_lines(center_x, center_y, radius, degrees_diff) {
    const lines = [];
    for (let angle = 0; angle < 360; angle += degrees_diff) {
        const radians = (angle * Math.PI) / 180;
        const x2 = center_x + radius * Math.cos(radians);
        const y2 = center_y + radius * Math.sin(radians);
        lines.push({
            x1: center_x,
            y1: center_y,
            x2: x2,
            y2: y2,
        });
    }
    return lines;
}

function generate_concentric_circles(center_x, center_y, max_radius, circle_count = 6) {
    const circles = [];
    const step = max_radius / circle_count;
    for (let r = step; r <= max_radius; r += step) {
        circles.push({
            cx: center_x,
            cy: center_y,
            r: r,
        });
    }
    return circles;
}

function get_sun_coordinates() {
    const now = new Date();
    const day = new Date(+now).setUTCHours(0, 0, 0, 0);
    const t = century(now);
    const longitude = ((day - now) / 864e5) * 360 - 180;
    return [longitude - equationOfTime(t) / 4, declination(t)];
}

function get_night_circle() {
    const antipode = ([longitude, latitude]) => [longitude + 180, -latitude];
    return d3.geoCircle().radius(90).center(antipode(get_sun_coordinates()))();
}

function SvgMap({
    map_controls,
    set_map_controls,
    set_cat_to_spot,
    radius_in_km,
    set_radius_in_km,
    auto_radius,
    set_auto_radius,
}) {
    const { spots, hovered_spot, set_hovered_spot, pinned_spot, set_pinned_spot, hovered_band } =
        useServerData();
    const { settings } = useSettings();

    const svg_ref = useRef(null);
    const [svg_box_ref, { width, height }] = useMeasure();
    const max_radius = 20000;
    const [drag_rotation, set_drag_rotation] = useState(null);
    const rotation_ref = useRef(null);

    const is_sm_device = useMediaQuery("only screen and (min-width : 640px)");
    const is_max_xs_device = useMediaQuery("only screen and (max-width : 500px)");

    const inner_padding = is_sm_device ? 45 : 5;
    const center_x = width / 2;
    const center_y = height / 2;
    const radius = Math.min(center_x, center_y) - inner_padding;
    const [center_lon, center_lat] = map_controls.location.location;

    const size_fit = radius * 2 - 15;
    const projectionType = map_controls.is_globe ? "geoOrthographic" : "geoAzimuthalEquidistant";
    const rotation = drag_rotation || [-center_lon, -center_lat, 0];
    rotation_ref.current = rotation;

    const projection = d3[projectionType]().precision(0.1);

    if (map_controls.is_globe) {
        projection.clipAngle(90);
    }

    projection
        .fitSize([size_fit, size_fit], dxcc_map)
        .rotate(rotation)
        .translate([center_x, center_y]);

    projection.scale((max_radius / radius_in_km) * projection.scale());

    const path_generator = d3.geoPath().projection(projection);

    const { colors } = useColors();

    useEffect(() => {
        const svg = d3.select(svg_ref.current);
        const zoom = d3
            .zoom()
            .scaleExtent([1, 20])
            .touchable(true)
            .filter(event => event.type != "touchstart" && event.type != "touchmove")
            .on("zoom", event => {
                set_radius_in_km((21 - Math.round(event.transform.k)) * 1000);
                if (
                    event.sourceEvent &&
                    (event.sourceEvent.type === "wheel" || event.sourceEvent.type === "touchmove")
                ) {
                    set_auto_radius(false);
                }
            });

        if (map_controls.is_globe) {
            const drag = d3
                .drag()
                .on("start", event => {
                    // Just mark that we're starting a drag
                })
                .on("drag", event => {
                    const current_rotation = rotation_ref.current;
                    const proj_radius = projection.scale();
                    const scale = 360 / (2 * Math.PI * proj_radius);

                    const new_rotation = [
                        current_rotation[0] + event.dx * scale,
                        current_rotation[1] - event.dy * scale,
                        current_rotation[2],
                    ];

                    set_drag_rotation(new_rotation);
                })
                .on("end", event => {
                    const current_rotation = rotation_ref.current;

                    const final_lon = -current_rotation[0];
                    const final_lat = -current_rotation[1];

                    const displayed_locator = new Maidenhead(final_lat, final_lon).locator.slice(
                        0,
                        6,
                    );
                    set_map_controls(
                        state =>
                            (state.location = {
                                displayed_locator,
                                location: [final_lon, final_lat],
                            }),
                    );

                    set_drag_rotation(null);
                });

            svg.call(drag);
        } else {
            svg.on(".drag", null);
            set_drag_rotation(null);
        }

        svg.call(zoom);

        const k_from_radius_in_km = 21 - radius_in_km / 1000;
        zoom.scaleTo(svg, k_from_radius_in_km);
    }, [map_controls]);

    const text_height = 20;
    const text_x = is_max_xs_device ? 10 : 20;
    const text_y = is_max_xs_device ? 20 : 30;

    let hovered_spot_data;
    let pinned_spot_data;
    let hovered_spot_distance;
    let pinned_spot_distance;
    const rendered_spots = spots.toReversed().map((spot, index) => {
        if (spot.id == hovered_spot.id) {
            hovered_spot_data = spot;
            hovered_spot_distance = (haversine(spot.dx_loc, spot.spotter_loc) / 1000).toFixed();
        }

        if (spot.id == pinned_spot) {
            pinned_spot_data = spot;
            pinned_spot_distance = (haversine(spot.dx_loc, spot.spotter_loc) / 1000).toFixed();
        }

        return (
            <Spot
                key={index}
                spot={spot}
                path_generator={path_generator}
                projection={projection}
                set_cat_to_spot={set_cat_to_spot}
                hovered_spot={hovered_spot}
                set_hovered_spot={set_hovered_spot}
                pinned_spot={pinned_spot}
                hovered_band={hovered_band}
                set_pinned_spot={set_pinned_spot}
            />
        );
    });

    let azimuth = null;

    if (spots.find(spot => spot.id === pinned_spot) || hovered_spot_data) {
        const spot_data = hovered_spot_data || spots.find(spot => spot.id === pinned_spot);
        azimuth = calculate_geographic_azimuth(
            center_lat,
            center_lon,
            spot_data.dx_loc[1],
            spot_data.dx_loc[0],
        );
    }

    return (
        <div
            ref={svg_box_ref}
            className="h-full w-full relative"
            style={{ backgroundColor: colors.theme.background }}
        >
            <svg
                ref={svg_ref}
                className="h-full w-full"
                onClick={event => {
                    const dims = svg_ref.current.getBoundingClientRect();
                    const x = event.clientX - dims.left;
                    const y = event.clientY - dims.top;
                    const distance_from_center = Math.sqrt(
                        (center_x - x) ** 2 + (center_y - y) ** 2,
                    );

                    if (event.detail == 2 && distance_from_center <= radius) {
                        const [lon, lat] = projection.invert([x, y]);
                        const displayed_locator = new Maidenhead(lat, lon).locator.slice(0, 6);
                        set_map_controls(
                            state =>
                                (state.location = {
                                    displayed_locator,
                                    location: [lon, lat],
                                }),
                        );
                    }
                }}
            >
                <defs>
                    <clipPath id="map-clip">
                        <circle r={radius} cx={center_x} cy={center_y} />
                    </clipPath>
                </defs>
                <circle r={radius} cx={center_x} cy={center_y} fill={colors.map.background} />

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

                {!map_controls.is_globe && (
                    <MapAngles
                        center_x={center_x}
                        center_y={center_y}
                        radius={radius + inner_padding / 2}
                        degrees_diff={map_angles_diff}
                        hovered_azimuth={azimuth}
                    />
                )}

                <g clipPath="url(#map-clip)">
                    {!map_controls.is_globe ? (
                        <g>
                            {generate_concentric_circles(center_x, center_y, radius).map(
                                (circle, index) => (
                                    <circle
                                        key={`circle-${index}`}
                                        cx={circle.cx}
                                        cy={circle.cy}
                                        r={circle.r}
                                        fill="none"
                                        stroke={colors.map.graticule}
                                        strokeWidth="1"
                                    />
                                ),
                            )}
                            {generate_radial_lines(center_x, center_y, radius, map_angles_diff).map(
                                (line, index) => (
                                    <line
                                        key={`line-${index}`}
                                        x1={line.x1}
                                        y1={line.y1}
                                        x2={line.x2}
                                        y2={line.y2}
                                        stroke={colors.map.graticule}
                                        strokeWidth="1"
                                    />
                                ),
                            )}
                        </g>
                    ) : (
                        <path
                            d={path_generator(d3.geoGraticule10())}
                            fill="none"
                            stroke={colors.map.graticule}
                            strokeWidth="1"
                            pointerEvents="none"
                        />
                    )}
                    {dxcc_map.features.map((shape, index) => {
                        return (
                            <path
                                fill={colors.map.land}
                                stroke={colors.map.land_borders}
                                pointerEvents="none"
                                key={index}
                                d={path_generator(shape)}
                                className="hover:cursor-pointer"
                            />
                        );
                    })}
                    {hovered_spot_data ||
                    (spots.find(spot => spot.id === pinned_spot) && hovered_spot.source !== "dx")
                        ? (() => {
                              const angle = (90 - azimuth) * (Math.PI / 180);
                              const x = center_x + radius * Math.cos(angle);
                              const y = center_y - radius * Math.sin(angle);
                              return (
                                  <line
                                      x1={center_x}
                                      y1={center_y}
                                      x2={x}
                                      y2={y}
                                      stroke="black"
                                      strokeWidth="1"
                                      strokeDasharray="5,5"
                                  />
                              );
                          })()
                        : ""}
                    {rendered_spots}
                </g>

                <g clipPath="url(#map-clip)">
                    {map_controls.night ? (
                        <path
                            pointerEvents="none"
                            fill={colors.map.night}
                            opacity="0.2"
                            d={path_generator(get_night_circle())}
                        />
                    ) : (
                        ""
                    )}
                    {settings.show_equator ? (
                        <path
                            stroke="black"
                            strokeWidth="2"
                            fill="none"
                            d={path_generator(d3.geoCircle().radius(90).center([0, 90])())}
                        />
                    ) : (
                        ""
                    )}
                </g>
                <circle
                    r={radius}
                    cx={center_x}
                    cy={center_y}
                    fill="none"
                    stroke={colors.map.borders}
                />
                <circle r="4" fill="#FF0000" cx={center_x} cy={center_y} />
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

export default SvgMap;

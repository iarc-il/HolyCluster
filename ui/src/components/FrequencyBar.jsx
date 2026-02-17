import Select from "@/components/Select.jsx";
import { useRef, useMemo } from "react";
import { useColors } from "../hooks/useColors";
import { useSpotData } from "@/hooks/useSpotData";
import { useSpotInteraction } from "@/hooks/useSpotInteraction";
import { useLocalStorage } from "@uidotdev/usehooks";
import use_radio from "../hooks/useRadio";
import { get_mode_shape } from "@/mode_shapes.js";
import { band_plans } from "@/band_plans.js";

function ModeShape({ mode, x, y, fill }) {
    const shape = get_mode_shape(mode);
    if (shape === "square") {
        return (
            <rect
                x={x}
                y={y}
                height={10}
                width={10}
                strokeWidth={1}
                fill={fill}
                className="group-hover:fill-blue-500"
            />
        );
    }
    if (shape === "triangle") {
        return (
            <svg
                x={x}
                y={y}
                height={12}
                width={12}
                viewBox="0 0 100 100"
                fill={fill}
                className="group-hover:fill-blue-500"
            >
                <polygon points="50 5, 100 90, 0 90" />
            </svg>
        );
    }
    return (
        <svg
            x={"54%"}
            y={y}
            height={15}
            width={15}
            viewBox="0 0 280 360"
            className="group-hover:fill-blue-500"
        >
            <polygon
                points="150,15 258,77 258,202 150,265 42,202 42,77"
                strokeWidth={1}
                className="group-hover:fill-blue-500"
                fill={fill}
            />
        </svg>
    );
}

function calculate_bracket_position(
    radio_freq,
    freq_spots,
    sorted_spots,
    min_freq,
    max_freq,
    band,
) {
    const has_freq_spots = Array.isArray(freq_spots) && freq_spots.length > 0;
    const group_freq = has_freq_spots
        ? (sorted_spots.find(s => s.id === freq_spots[0])?.freq ?? radio_freq)
        : radio_freq;

    const lower_spot = [...sorted_spots]
        .reverse()
        .find(s => s.freq < group_freq && !(has_freq_spots && freq_spots.includes(s.id)));
    const upper_spot = sorted_spots.find(
        s => s.freq > group_freq && !(has_freq_spots && freq_spots.includes(s.id)),
    );

    const lower_idx = lower_spot ? sorted_spots.findIndex(s => s.id === lower_spot.id) : -1;
    const upper_idx = upper_spot ? sorted_spots.findIndex(s => s.id === upper_spot.id) : -1;

    const y_lower = lower_idx !== -1 ? (lower_idx * 100) / sorted_spots.length + 3 : 3;
    const y_upper =
        upper_idx !== -1
            ? (upper_idx * 100) / sorted_spots.length + 3
            : ((sorted_spots.length - 1) * 100) / sorted_spots.length + 3;

    const c_bracket_y = (y_lower + y_upper) / 2;

    let bracket_y = c_bracket_y - 0.5;
    let bracket_height = 1;

    if (has_freq_spots && freq_spots.length === 1) {
        const idx = sorted_spots.findIndex(s => s.id === freq_spots[0]);
        bracket_y = (idx * 100) / sorted_spots.length + 1;
        const last_y = (idx * 100) / sorted_spots.length + 3.7;
        bracket_height = last_y - bracket_y;
    } else if (has_freq_spots && freq_spots.length > 1) {
        const indices = freq_spots
            .map(id => sorted_spots.findIndex(s => s.id === id))
            .filter(idx => idx !== -1)
            .sort((a, b) => a - b);

        if (indices.length > 0) {
            const first_y = (indices[0] * 100) / sorted_spots.length + 1;
            const last_y = (indices[indices.length - 1] * 100) / sorted_spots.length + 3.7;
            bracket_y = first_y;
            bracket_height = last_y - first_y;
        }
    }

    if (!has_freq_spots) {
        const lower = [...sorted_spots].reverse().find(s => s.freq < radio_freq);
        const upper = sorted_spots.find(s => s.freq > radio_freq);

        if (lower && upper) {
            const li = sorted_spots.findIndex(s => s.id === lower.id);
            const ui = sorted_spots.findIndex(s => s.id === upper.id);
            const yl = (li * 100) / sorted_spots.length + 0.5;
            const yu = (ui * 100) / sorted_spots.length + 0.5;
            const freq_pos = (radio_freq - lower.freq) / (upper.freq - lower.freq);
            bracket_y = yl + (yu - yl) * freq_pos;
        } else if (lower) {
            const li = sorted_spots.findIndex(s => s.id === lower.id);
            const yl = (li * 100) / sorted_spots.length + 0.5;
            const freq_pos = (radio_freq - lower.freq) / (band_plans[band].max - lower.freq);
            bracket_y = yl + (100 + 0.5 - yl) * freq_pos;
        } else if (upper) {
            const ui = sorted_spots.findIndex(s => s.id === upper.id);
            const yu = (ui * 100) / sorted_spots.length + 0.5;
            const freq_pos =
                (radio_freq - band_plans[band].min) / (upper.freq - band_plans[band].min);
            bracket_y = 0.5 + (yu - 0.5) * freq_pos;
        } else {
            bracket_y = ((radio_freq - min_freq) / (max_freq - min_freq)) * 100 - 4;
        }
    }

    return { bracket_y, bracket_height };
}

export default function FrequencyBar({ className, set_cat_to_spot }) {
    const { colors } = useColors();
    const { spots, current_freq_spots: freq_spots } = useSpotData();
    const { hovered_spot, set_hovered_spot, pinned_spot, set_pinned_spot } = useSpotInteraction();
    // Set to -1 to use the current band that the radio is on
    const [selected_band, set_selected_band] = useLocalStorage("freq_bar_selected_freq", 20);

    let { radio_band, radio_freq, radio_status } = use_radio();

    radio_freq = radio_freq && radio_freq >= 0 ? Math.round((radio_freq / 1000) * 10) / 10 : 0;

    let band = selected_band == -1 ? radio_band : selected_band;

    // Sort spots by frequency
    let sorted_spots = useMemo(() => {
        return spots
            .filter(spot => spot.band == band)
            .slice(0, 30)
            .sort((a, b) => a.freq - b.freq);
    }, [spots, band]);

    const callsign_refs = useRef([]);

    let freq_offset, max_freq, min_freq, features, ranges;

    if (band_plans[band]) {
        freq_offset = (band_plans[band].max - band_plans[band].min) / 50;

        max_freq = band_plans[band].max + freq_offset;
        min_freq = band_plans[band].min - freq_offset;
        features = band_plans[band].features;
        ranges = band_plans[band].ranges;
    }

    // Remove all spots with duplicate dx_callsign keeping only the most recent one
    sorted_spots = sorted_spots.reduce((acc, spot) => {
        const existingSpot = acc.find(s => s.dx_callsign === spot.dx_callsign);
        if (!existingSpot || existingSpot.time < spot.time) {
            return acc.filter(s => s.dx_callsign !== spot.dx_callsign).concat(spot);
        }
        return acc;
    }, []);

    function dx_handle_click(spot_id, spot) {
        if (pinned_spot === spot_id) {
            set_pinned_spot(null);
        } else {
            set_pinned_spot(spot_id);

            if (!(radio_status == "connected")) return;

            set_cat_to_spot(spot);
            set_selected_band(-1);
        }
    }

    let bracket_y, bracket_height;

    if (radio_freq) {
        ({ bracket_y, bracket_height } = calculate_bracket_position(
            radio_freq,
            freq_spots,
            sorted_spots,
            min_freq,
            max_freq,
            band,
        ));
    }

    return (
        <div className={className}>
            <span className={`w-full flex flex-row items-center justify-between h-[10%]`}>
                <Select
                    value={selected_band}
                    onChange={event => {
                        set_selected_band(event.target.value);
                    }}
                    text_color={selected_band == -1 ? colors.bands[radio_band] : undefined}
                    className={`text-lg p-2 w-full text-center`}
                >
                    {radio_status === "connected" && (
                        <option style={{ color: colors.bands[radio_band] }} value={-1}>
                            Radio
                        </option>
                    )}

                    {Object.keys(band_plans)
                        .sort((a, b) => b - a)
                        .map(band => {
                            return (
                                <option
                                    key={band}
                                    style={{ color: colors.theme.text }}
                                    value={band}
                                >
                                    {band}
                                    {Number.isNaN(Number(band)) ? "" : "m"}
                                </option>
                            );
                        })}
                </Select>
            </span>

            {!(selected_band == -1 && radio_band == -1) && (
                <>
                    <svg
                        className={`w-full h-[85%] left-0 box-border`}
                        style={{ background: colors.theme.background }}
                    >
                        <Ruler
                            min_freq={min_freq}
                            max_freq={max_freq}
                            radio_freq={radio_freq}
                            band={band}
                            radio_status={radio_status}
                        />

                        {sorted_spots.map((spot, i) => {
                            const highlight_spot =
                                (radio_status === "connected" && freq_spots.includes(spot.id)) ||
                                (radio_status !== "connected" && spot.id == pinned_spot) ||
                                spot.id === hovered_spot.id;

                            const spot_y_pct = `${(i * 100) / sorted_spots.length + 3}%`;

                            return (
                                <g
                                    className="group group-hover:stroke-blue-500 group-hover:fill-blue-500"
                                    key={`freq_bar_${spot.id}`}
                                    onMouseLeave={_ =>
                                        set_hovered_spot({
                                            source: null,
                                            id: null,
                                        })
                                    }
                                >
                                    <line
                                        x1={"30%"}
                                        x2={"54%"}
                                        y1={`${
                                            ((spot.freq - min_freq) / (max_freq - min_freq)) * 100
                                        }%`}
                                        y2={`${(i * 100) / sorted_spots.length + 2.5}%`}
                                        strokeWidth={highlight_spot ? "2" : "1"}
                                        stroke={highlight_spot ? "#3b82f6" : colors.theme.text}
                                        className={`group-hover:opacity-100 ${
                                            highlight_spot ? "opacity-75" : "opacity-25"
                                        }`}
                                        onClick={() => {
                                            dx_handle_click(spot.id, spot);
                                        }}
                                        onMouseEnter={() =>
                                            set_hovered_spot({
                                                source: "bar",
                                                id: spot.id,
                                            })
                                        }
                                    />

                                    <g
                                        id={`text_callsign_${i}`}
                                        onClick={() => {
                                            dx_handle_click(spot.id, spot);
                                        }}
                                        className="hover:cursor-pointer w-full"
                                    >
                                        <g style={{ transform: "translateY(-10px)" }}>
                                            <ModeShape
                                                mode={spot.mode}
                                                x={"55%"}
                                                y={spot_y_pct}
                                                fill={colors.theme.text}
                                            />
                                        </g>

                                        <text
                                            x={"61%"}
                                            ref={el => (callsign_refs.current[i] = el)}
                                            y={spot_y_pct}
                                            fontSize="14"
                                            fill={colors.theme.text}
                                            className="group-hover:fill-blue-500 border-2 border-black border-solid"
                                            onClick={() => {
                                                dx_handle_click(spot.id, spot);
                                            }}
                                            onMouseEnter={() =>
                                                set_hovered_spot({
                                                    source: "bar",
                                                    id: spot.id,
                                                })
                                            }
                                        >
                                            {spot.dx_callsign}
                                        </text>
                                    </g>

                                    {highlight_spot && (
                                        <rect
                                            x={"54%"}
                                            y={spot_y_pct}
                                            height={20}
                                            width={
                                                callsign_refs.current[i]
                                                    ? callsign_refs.current[i].getBBox().width + 20
                                                    : 20
                                            }
                                            rx={5}
                                            ry={5}
                                            strokeWidth="2"
                                            stroke={"#3b82f6"}
                                            fillOpacity="0"
                                            className="-translate-y-[15px] hover:cursor-pointer"
                                            onClick={() => {
                                                dx_handle_click(spot.id, spot);
                                            }}
                                        />
                                    )}
                                </g>
                            );
                        })}

                        {radio_freq != 0 && radio_freq !== undefined && freq_spots.length >= 1 && (
                            <svg
                                width="100%"
                                height={`${bracket_height}%`}
                                x="0"
                                y={`${bracket_y}%`}
                                style={{
                                    position: "absolute",
                                    pointerEvents: "none",
                                }}
                            >
                                {/* Left vertical */}
                                <line
                                    x1={`50%`}
                                    y1="0"
                                    x2={`50%`}
                                    y2={"100%"}
                                    stroke={colors.theme.text}
                                    strokeWidth="2"
                                />
                                {/* Top horizontal */}
                                <line
                                    x1={`50%`}
                                    y1="0"
                                    x2={`53%`}
                                    y2="0"
                                    stroke={colors.theme.text}
                                    strokeWidth="2"
                                />
                                {/* Bottom horizontal */}
                                <line
                                    x1={`50%`}
                                    y1={"100%"}
                                    x2={`53%`}
                                    y2={"100%"}
                                    stroke={colors.theme.text}
                                    strokeWidth="2"
                                />
                            </svg>
                        )}
                        {radio_freq != 0 && radio_freq !== undefined && freq_spots.length == 0 && (
                            <svg
                                viewBox="0 0 50 90"
                                height="8%"
                                width="5%"
                                y={`${bracket_y - 2.5}%`}
                                x="47.5%"
                            >
                                <polygon
                                    points="0 0, 50 45, 0 90"
                                    fill="transparent"
                                    stroke="red"
                                    strokeWidth={5}
                                />
                            </svg>
                        )}
                    </svg>
                    <div className="h-[4%] w-full flex justify-center items-center bg-gray-100 rounded-full border border-gray-300">
                        {ranges.concat(features).map(legend => (
                            <p
                                style={{ color: legend.color }}
                                key={`legend_${legend.name}`}
                                className="text-[14px] inline px-[0.4rem] font-medium"
                            >
                                {legend.name.toUpperCase()}
                            </p>
                        ))}
                    </div>{" "}
                </>
            )}

            {selected_band == -1 && radio_band == -1 && (
                <>
                    <p style={{ color: colors.theme.text }} className="px-2 pt-2 text-md">
                        The radio could not be reached!
                    </p>
                    <p style={{ color: colors.theme.text }} className="px-2 py-1 text-md">
                        please ensure that it is connected or select a band manually.
                    </p>
                    <p style={{ color: colors.theme.text }} className="px-2 text-md">
                        Once the radio connects the page will update automatically.
                    </p>
                </>
            )}
        </div>
    );
}

function Ruler({ max_freq, min_freq, radio_freq, band, radio_status }) {
    const { colors } = useColors();

    const step_size =
        Math.floor((band_plans[band].max - band_plans[band].min) / 50) === 0
            ? 1
            : Math.floor((band_plans[band].max - band_plans[band].min) / 50);

    // An array of numbers between min_freq and max_freq in increments of 10
    const marking_array = useMemo(() => {
        const arr = [];
        for (let i = band_plans[band].min; i <= band_plans[band].max; i += step_size) {
            arr.push(i);
        }
        return arr;
    }, [band_plans[band].min, band_plans[band].max]);

    const features = band_plans[band].features;
    const ranges = band_plans[band].ranges;

    return (
        <>
            {marking_array.map((mark, i) => {
                return i % 10 === 0 ? (
                    <g key={`ruler_${mark}`}>
                        <text
                            y={`${((mark - min_freq) / (max_freq - min_freq)) * 100}%`}
                            x1={0}
                            fontSize="14"
                            fill={colors.theme.text}
                            className="translate-y-[4px]"
                        >
                            {mark}
                        </text>
                        <line
                            y1={`${((mark - min_freq) / (max_freq - min_freq)) * 100}%`}
                            y2={`${((mark - min_freq) / (max_freq - min_freq)) * 100}%`}
                            x1={"25%"}
                            x2={"30%"}
                            stroke={colors.theme.text}
                            strokeWidth="1"
                        ></line>
                    </g>
                ) : (
                    <line
                        y1={`${((mark - min_freq) / (max_freq - min_freq)) * 100}%`}
                        y2={`${((mark - min_freq) / (max_freq - min_freq)) * 100}%`}
                        x1={"20%"}
                        x2={"30%"}
                        stroke={colors.theme.text}
                        strokeWidth="1"
                        key={`ruler_${mark}`}
                    ></line>
                );
            })}

            {features.map(feature => (
                <g key={`ruler_feature_${feature.name}`}>
                    <line
                        y1={`${((feature.freq - min_freq) / (max_freq - min_freq)) * 100}%`}
                        y2={`${((feature.freq - min_freq) / (max_freq - min_freq)) * 100}%`}
                        x1={"19%"}
                        x2={"30%"}
                        stroke={feature.color}
                        strokeWidth="2"
                    ></line>
                </g>
            ))}

            {ranges.map(range => (
                <g key={`ruler_range_${range.name}`}>
                    <line
                        y1={`${((range.min - min_freq) / (max_freq - min_freq)) * 100}%`}
                        y2={`${((range.max - min_freq) / (max_freq - min_freq)) * 100}%`}
                        x1={"30%"}
                        x2={"30%"}
                        stroke={range.color}
                        strokeWidth="1"
                    ></line>
                </g>
            ))}

            {radio_status === "connected" && radio_freq != 0 && radio_freq !== undefined && (
                <svg
                    viewBox="0 0 50 90"
                    height="8%"
                    width="5%"
                    y={`${((radio_freq - min_freq) / (max_freq - min_freq)) * 100 - 4}%`}
                    x="25%"
                >
                    <polygon
                        points="0 0, 50 45, 0 90"
                        fill="red"
                        stroke={colors.theme.text}
                        strokeWidth={5}
                    />
                </svg>
            )}
        </>
    );
}

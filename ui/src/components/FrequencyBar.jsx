import Select from "@/components/Select.jsx";
import Toggle from "@/components/Toggle.jsx";
import { useMemo, useState } from "react";
import { useColors } from "../hooks/useColors";
import { useLocalStorage } from "@uidotdev/usehooks";

const ft8_color = "#FF0000";
const ft4_color = "#0000FF";
const ssb_color = "#189f18";
const cw_color = "#ff8e23";

const band_plans = {
    160: {
        min: 1800,
        max: 2000,
        ranges: [
            { name: "cw", min: 1800, max: 1840, color: cw_color },
            { name: "ssb", min: 1840, max: 2000, color: ssb_color },
        ],
        features: [{ name: "FT8", freq: 1840, color: ft8_color }],
    },
    80: {
        min: 3500,
        max: 4000,
        ranges: [
            { name: "cw", min: 3500, max: 3600, color: cw_color },
            { name: "ssb", min: 3600, max: 4000, color: ssb_color },
        ],
        features: [
            { name: "FT8", freq: 3573, color: ft8_color },
            { name: "FT4", freq: 3575, color: ft4_color },
        ],
    },
    60: {
        min: 5351,
        max: 5366,
        ranges: [
            { name: "cw", min: 5351, max: 5354, color: cw_color },
            { name: "ssb", min: 5354, max: 5366, color: ssb_color },
        ],
        features: [{ name: "FT8", freq: 5375, color: ft8_color }],
    },
    40: {
        min: 7000,
        max: 7300,
        ranges: [
            { name: "cw", min: 7000, max: 7040, color: cw_color },
            { name: "ssb", min: 7040, max: 7300, color: ssb_color },
        ],
        features: [
            { name: "FT8", freq: 7074, color: ft8_color },
            { name: "FT4", freq: 7047, color: ft4_color },
        ],
    },
    30: {
        min: 10100,
        max: 10150,
        ranges: [
            { name: "cw", min: 10100, max: 10130, color: cw_color },
            { name: "ssb", min: 10130, max: 10150, color: ssb_color },
        ],
        features: [
            { name: "FT8", freq: 10136, color: ft8_color },
            { name: "FT4", freq: 10140, color: ft4_color },
        ],
    },
    20: {
        min: 14000,
        max: 14350,
        ranges: [
            { name: "cw", min: 14000, max: 14101, color: cw_color },
            { name: "ssb", min: 14101, max: 14350, color: ssb_color },
        ],
        features: [
            { name: "FT8", freq: 14074, color: ft8_color },
            { name: "FT4", freq: 14080, color: ft4_color },
        ],
    },
    17: {
        min: 18068,
        max: 18168,
        ranges: [
            { name: "cw", min: 18068, max: 18111, color: cw_color },
            { name: "ssb", min: 18111, max: 18168, color: ssb_color },
        ],
        features: [
            { name: "FT8", freq: 18100, color: ft8_color },
            { name: "FT4", freq: 18104, color: ft4_color },
        ],
    },
    15: {
        min: 21000,
        max: 21450,
        ranges: [
            { name: "cw", min: 21000, max: 21151, color: cw_color },
            { name: "ssb", min: 21151, max: 21450, color: ssb_color },
        ],
        features: [
            { name: "FT8", freq: 21074, color: ft8_color },
            { name: "FT4", freq: 21140, color: ft4_color },
        ],
    },
    12: {
        min: 24890,
        max: 24990,
        ranges: [
            { name: "cw", min: 24890, max: 24931, color: cw_color },
            { name: "ssb", min: 24931, max: 24990, color: ssb_color },
        ],
        features: [
            { name: "FT8", freq: 24915, color: ft8_color },
            { name: "FT4", freq: 24919, color: ft4_color },
        ],
    },
    10: {
        min: 28000,
        max: 29700,
        ranges: [
            { name: "cw", min: 28000, max: 28320, color: cw_color },
            { name: "ssb", min: 28320, max: 29700, color: ssb_color },
        ],
        features: [
            { name: "FT8", freq: 28074, color: ft8_color },
            { name: "FT4", freq: 28180, color: ft4_color },
        ],
    },
    6: {
        min: 50000,
        max: 52000,
        ranges: [
            { name: "cw", min: 50000, max: 50100, color: cw_color },
            { name: "ssb", min: 50100, max: 52000, color: ssb_color },
        ],
        features: [
            { name: "FT8", freq: 50313, color: ft8_color },
            { name: "FT4", freq: 50318, color: ft4_color },
        ],
    },
    4: {
        min: 70000,
        max: 70500,
        ranges: [
            { name: "cw", min: 70100, max: 70250, color: cw_color },
            { name: "ssb", min: 70250, max: 70500, color: ssb_color },
        ],
        features: [{ name: "FT8", freq: 70100, color: ft8_color }],
    },
};

export default function FrequencyBar({
    spots,
    pinned_spot,
    set_pinned_spot,
    className,
    radio_status,
    radio_freq,
    set_cat_to_spot,
    cat_control,
    set_cat_control,
    hovered_spot,
    set_hovered_spot,
}) {
    const { colors } = useColors();
    const [selected_band, set_selected_band] = useLocalStorage("freq_bar_selected_freq", 20); // Set to -1 to use the current band that the radio is on

    function get_band_from_freq(freq) {
        for (let band of Object.keys(band_plans)) {
            if (freq <= band_plans[band].max && freq >= band_plans[band].min) return band;
        }

        return selected_band;
    }

    let radio_band = get_band_from_freq(radio_freq);

    const band = selected_band == -1 ? radio_band : selected_band;

    // Sort spots by frequency
    let sorted_spots = useMemo(() => {
        return spots
            .filter(spot => spot.band == band)
            .slice(0, 30)
            .sort((a, b) => a.freq - b.freq);
    }, [spots, band]);

    const freq_offset = (band_plans[band].max - band_plans[band].min) / 50;

    const max_freq = band_plans[band].max + freq_offset;
    const min_freq = band_plans[band].min - freq_offset;

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

    const features = band_plans[band].features;
    const ranges = band_plans[band].ranges;

    let spot_highlighted = false; // Used to only highlight most recent spot of same frequency as radio

    return (
        <div className={className}>
            <span className={`w-full flex flex-row items-center justify-between h-[10%]`}>
                <Select
                    value={selected_band}
                    onChange={event => {
                        set_selected_band(event.target.value);
                    }}
                    text_color={selected_band == -1 ? colors.bands[radio_band] : undefined}
                    className={`text-lg p-2 w-1/2 text-center`}
                >
                    {radio_status === "connected" && (
                        <option style={{ color: colors.bands[radio_band] }} value={-1}>
                            Radio
                        </option>
                    )}

                    {Object.keys(band_plans).map(band => {
                        return (
                            <option key={band} style={{ color: colors.theme.text }} value={band}>
                                {band}m
                            </option>
                        );
                    })}
                </Select>

                {radio_status === "connected" && (
                    <span className="flex flex-col items-center justify-center w-1/4 mx-3">
                        <p className="h-1/4" style={{ color: colors.theme.text }}>
                            CAT
                        </p>
                        <Toggle
                            class_name={"h-1/4"}
                            on_click={() => {
                                if (cat_control == 1) {
                                    set_cat_control(0);
                                } else {
                                    set_cat_control(1);
                                }
                            }}
                            value={cat_control}
                        />
                    </span>
                )}
            </span>

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
                        (radio_status === "connected" &&
                            radio_freq == spot.freq &&
                            !spot_highlighted) ||
                        (radio_status !== "connected" && spot.id == pinned_spot) ||
                        spot.id === hovered_spot.id;

                    if (highlight_spot) {
                        spot_highlighted = true;
                    }

                    return (
                        <g
                            className="group group-hover:stroke-blue-500 group-hover:fill-blue-500"
                            key={`freq_bar_${spot.id}`}
                            onMouseLeave={_ => set_hovered_spot({ source: null, id: null })}
                        >
                            <line
                                x1={"30%"}
                                x2={"54%"}
                                y1={`${((spot.freq - min_freq) / (max_freq - min_freq)) * 100}%`}
                                y2={`${(i * 100) / sorted_spots.length + 2}%`}
                                strokeWidth="1"
                                stroke={
                                    highlight_spot ? colors.bands[spot.band] : colors.theme.text
                                }
                                className="group-hover:opacity-100 opacity-25"
                                onClick={() => {
                                    dx_handle_click(spot.id, spot);
                                }}
                                onMouseEnter={() =>
                                    set_hovered_spot({ source: "bar", id: spot.id })
                                }
                            />

                            <g
                                id={`text_callsign_${i}`}
                                onClick={() => {
                                    dx_handle_click(spot.id, spot);
                                }}
                                className="hover:cursor-pointer"
                            >
                                {spot.mode.toUpperCase() == "SSB" && (
                                    <rect
                                        x={"55%"}
                                        y={`${(i * 100) / sorted_spots.length + 2.3}%`}
                                        height={10}
                                        width={10}
                                        strokeWidth={1}
                                        fill={colors.theme.text}
                                        className="-translate-y-[5px] group-hover:fill-blue-500"
                                    />
                                )}

                                {spot.mode.toUpperCase() == "CW" && (
                                    <svg
                                        x={"55%"}
                                        y={`${(i * 100) / sorted_spots.length + 1.4}%`}
                                        height={12}
                                        width={12}
                                        viewBox="0 0 100 100"
                                        fill={colors.theme.text}
                                        className="-translate-y-[5px] group-hover:fill-blue-500"
                                    >
                                        <polygon points="50 15, 100 100, 0 100" />
                                    </svg>
                                )}

                                {["FT8", "FT4", "DIGI"].includes(spot.mode.toUpperCase()) && (
                                    <svg
                                        x={"54%"}
                                        y={`${(i * 100) / sorted_spots.length + 1.4}%`}
                                        height={15}
                                        width={15}
                                        viewBox="0 0 280 360"
                                        className="-translate-y-[5px] group-hover:fill-blue-500"
                                    >
                                        <polygon
                                            points="150,15 258,77 258,202 150,265 42,202 42,77"
                                            strokeWidth={1}
                                            className="group-hover:fill-blue-500"
                                            fill={colors.theme.text}
                                        />
                                    </svg>
                                )}

                                <text
                                    x={"61%"}
                                    y={`${(i * 100) / sorted_spots.length + 3}%`}
                                    fontSize="14"
                                    fill={colors.theme.text}
                                    className="group-hover:fill-blue-500 border-2 border-black border-solid"
                                    onClick={() => {
                                        dx_handle_click(spot.id, spot);
                                    }}
                                    onMouseEnter={() =>
                                        set_hovered_spot({ source: "bar", id: spot.id })
                                    }
                                >
                                    {spot.dx_callsign}
                                </text>
                            </g>

                            {highlight_spot && (
                                <rect
                                    x={"54%"}
                                    y={`${(i * 100) / sorted_spots.length + 3}%`}
                                    height={20}
                                    width={
                                        document.getElementById(`text_callsign_${i}`)
                                            ? document
                                                  .getElementById(`text_callsign_${i}`)
                                                  .getBoundingClientRect().width + 4
                                            : 20
                                    }
                                    rx={5}
                                    ry={5}
                                    strokeWidth={1}
                                    stroke={colors.bands[spot.band]}
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
            </svg>

            <div className="h-[5%] w-full flex justify-center items-center">
                {features
                    .concat(ranges)
                    .reverse()
                    .map(legend => (
                        <p
                            style={{ color: legend.color }}
                            key={`legend_${legend.name}`}
                            className="text-[14px] inline px-[0.4rem] bg-gray-100 rounded-full m-1 border border-gray-300 font-medium"
                        >
                            {legend.name.toUpperCase()}
                        </p>
                    ))}
            </div>
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

            {radio_status === "connected" && (
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

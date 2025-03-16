import { useMemo, useReducer, useState } from "react";
import { useColors } from "../hooks/useColors";

const band_to_freq = {
    4: [],
    6: [50000, 54000],
    10: [28000, 29700],
    12: [24890, 24990],
    15: [21000, 21450],
    17: [18068, 18168],
    20: [13953, 14350],
    30: [10100, 10150],
    40: [7000, 7300],
    60: [5330, 5405],
    80: [3500, 4000],
    160: [1800, 2000],
};

export default function FrequencyBar({
    spots,
    pinned_spot,
    set_pinned_spot,
    className,
    radio_status,
    radio_freq,
    set_cat_to_spot,
}) {
    const { colors } = useColors();

    function get_band_from_freq(freq) {
        for (let band of Object.keys(band_to_freq)) {
            if (freq <= band_to_freq[band][1] && freq >= band_to_freq[band][0]) return band;
        }

        return 20;
    }

    let radio_band = get_band_from_freq(radio_freq);

    // Sort spots by frequency
    let sorted_spots = useMemo(() => {
        return spots.filter(spot => spot.band == radio_band).sort((a, b) => a.freq - b.freq);
    }, [spots, radio_band]);

    const max_freq = band_to_freq[radio_band][1];
    const min_freq = band_to_freq[radio_band][0];

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

            if (!(radio_status === "connected")) return;

            set_cat_to_spot(spot);
        }
    }

    return (
        <svg
            className={`${className} w-full left-0 top-0 box-border`}
            style={{ background: colors.theme.background }}
        >
            <Ruler min_freq={min_freq} max_freq={max_freq} radio_freq={radio_freq} />

            {sorted_spots.map((spot, i) => {
                return (
                    <g
                        className="group group-hover:stroke-blue-500 group-hover:fill-blue-500"
                        key={`freq_bar_${spot.id}`}
                    >
                        <line
                            x1={"30%"}
                            x2={"59%"}
                            y1={`${((spot.freq - min_freq) / (max_freq - min_freq)) * 100}%`}
                            y2={`${(i * 100) / sorted_spots.length + 3}%`}
                            strokeWidth="1"
                            stroke={colors.theme.text}
                            className="group-hover:stroke-blue-500 group-hover:opacity-100 opacity-25"
                            onClick={() => {
                                dx_handle_click(spot.id, spot);
                            }}
                        ></line>
                        <text
                            x={"60%"}
                            y={`${(i * 100) / sorted_spots.length + 3}%`}
                            fontSize="12"
                            fontWeight="bold"
                            fill={colors.theme.text}
                            className="hover:cursor-pointer group-hover:fill-blue-500"
                            onClick={() => {
                                dx_handle_click(spot.id, spot);
                            }}
                        >
                            {spot.dx_callsign}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}

function Ruler({ max_freq, min_freq, radio_freq }) {
    const { colors } = useColors();

    // An array of numbers between min_freq and max_freq in increments of 10
    const marking_array = useMemo(() => {
        const arr = [];
        for (let i = Math.ceil(min_freq / 10) * 10; i <= max_freq; i += 10) {
            arr.push(i);
        }
        return arr;
    }, [min_freq, max_freq]);

    return (
        <>
            {marking_array.map(mark => {
                return mark % 100 === 0 ? (
                    <g key={`ruler_${mark}`}>
                        <text
                            y={`${((mark - min_freq) / (max_freq - min_freq)) * 100}%`}
                            x1={0}
                            fontSize="12"
                            fontWeight="bold"
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
                    ></line>
                );
            })}

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
        </>
    );
}

import Select from "@/components/Select.jsx";
import { useMemo, useState } from "react";
import { useColors } from "../hooks/useColors";
import { useLocalStorage } from "@uidotdev/usehooks";

const band_to_freq = {
    4: [70000, 70500],
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
    const [selected_band, set_selected_band] = useLocalStorage("freq_bar_selected_freq", 20); // Set to -1 to use the current band that the radio is on

    function get_band_from_freq(freq) {
        for (let band of Object.keys(band_to_freq)) {
            if (freq <= band_to_freq[band][1] && freq >= band_to_freq[band][0]) return band;
        }

        return 20;
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

    const max_freq = band_to_freq[band][1] + 15;
    const min_freq = band_to_freq[band][0] - 15;

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

    let spot_highlighted = false; // Used to only highlight most recent spot of same frequency as radio

    return (
        <div className={className}>
            <span className={`w-full flex items-center justify-center h-[10%]`}>
                <Select
                    value={selected_band}
                    onChange={event => {
                        set_selected_band(event.target.value);
                    }}
                    text_color={selected_band == -1 ? colors.bands[radio_band] : undefined}
                    className={`text-lg p-2 min-w-[50%] text-center`}
                >
                    {radio_status === "connected" && (
                        <option style={{ color: colors.bands[radio_band] }} value={-1}>
                            Radio
                        </option>
                    )}

                    {Object.keys(band_to_freq).map(band => {
                        return (
                            <option key={band} style={{ color: colors.theme.text }} value={band}>
                                {band}m
                            </option>
                        );
                    })}
                </Select>
            </span>

            <svg
                className={`w-full h-[90%] left-0 box-border`}
                style={{ background: colors.theme.background }}
            >
                <Ruler min_freq={min_freq} max_freq={max_freq} radio_freq={radio_freq} />

                {sorted_spots.map((spot, i) => {
                    const highlight_spot =
                        (radio_status === "connected" &&
                            radio_freq == spot.freq &&
                            !spot_highlighted) ||
                        (radio_status !== "connected" && spot.id == pinned_spot);

                    if (highlight_spot) {
                        spot_highlighted = true;
                    }

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
                                stroke={
                                    highlight_spot ? colors.bands[spot.band] : colors.theme.text
                                }
                                className="group-hover:stroke-blue-500 group-hover:opacity-100 opacity-25"
                                onClick={() => {
                                    dx_handle_click(spot.id, spot);
                                }}
                            />
                            <text
                                x={"60%"}
                                y={`${(i * 100) / sorted_spots.length + 3}%`}
                                fontSize="12"
                                fontWeight="bold"
                                fill={colors.theme.text}
                                className="hover:cursor-pointer group-hover:fill-blue-500 border-2 border-black border-solid"
                                onClick={() => {
                                    dx_handle_click(spot.id, spot);
                                }}
                                id={`text_callsign_${i}`}
                            >
                                {spot.dx_callsign}
                            </text>

                            {highlight_spot && (
                                <rect
                                    x={"59%"}
                                    y={`${(i * 100) / sorted_spots.length + 3}%`}
                                    height={20}
                                    width={
                                        document.getElementById(`text_callsign_${i}`)
                                            ? document
                                                  .getElementById(`text_callsign_${i}`)
                                                  .getComputedTextLength() + 4
                                            : 20
                                    }
                                    rx={5}
                                    ry={5}
                                    strokeWidth={1}
                                    stroke={colors.bands[spot.band]}
                                    fillOpacity="0"
                                    className="-translate-y-[15px]"
                                />
                            )}
                        </g>
                    );
                })}
            </svg>

            {/* <div className="grid grid-rows-2 grid-cols-2 w-full h-[10%]">
				{(Object.keys(mode_to_color)).map((mode) => {
					return (<span className="flex flex-row p-2">
						<span
							className="h-full w-1/2 mr-2"
							style={{ backgroundColor: mode_to_color[mode] }}
						></span>
						<p className={`text-[${mode_to_color[mode]}]`}>{mode}</p>
					</span>);
				})}
			</div> */}
        </div>
    );
}

function Ruler({ max_freq, min_freq, radio_freq }) {
    const { colors } = useColors();

    const step_size = Math.floor((max_freq - min_freq) / 50);

    // An array of numbers between min_freq and max_freq in increments of 10
    const marking_array = useMemo(() => {
        const arr = [];
        for (let i = Math.ceil(min_freq / step_size) * step_size; i <= max_freq; i += step_size) {
            arr.push(i);
        }
        return arr;
    }, [min_freq, max_freq]);

    return (
        <>
            {marking_array.map(mark => {
                return mark % (step_size * 10) === 0 ? (
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
                        key={`ruler_${mark}`}
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

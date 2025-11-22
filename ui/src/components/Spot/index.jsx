import Hexagon from "./components/Hexagon.jsx";
import Square from "./components/Square.jsx";
import Triangle from "./components/Triangle.jsx";
import { to_radian } from "@/utils.js";
import { useColors } from "@/hooks/useColors";
import { useServerData } from "@/hooks/useServerData";

function Spot({
    spot,
    path_generator,
    projection,
    set_cat_to_spot,
    hovered_spot,
    set_hovered_spot,
    pinned_spot,
    set_pinned_spot,
    hovered_band,
}) {
    const { current_freq_spots } = useServerData();
    const { colors } = useColors();
    const line = {
        type: "LineString",
        coordinates: [spot.spotter_loc, spot.dx_loc],
        properties: {
            band: spot.band,
            freq: Number(spot.freq) * 1000,
            mode: spot.mode,
        },
    };

    const spotter_point = { type: "Point", coordinates: spot.spotter_loc };
    const dx_point = { type: "Point", coordinates: spot.dx_loc };

    const spotter_path = path_generator(spotter_point);
    const dx_path = path_generator(dx_point);

    const spotter_visible = spotter_path !== null;
    const dx_visible = dx_path !== null;

    if (!spotter_visible && !dx_visible) {
        return null;
    }

    const spotter_proj = projection(spot.spotter_loc);
    const dx_proj = projection(spot.dx_loc);

    const [spotter_x, spotter_y] = spotter_proj || [0, 0];
    const [dx_x, dx_y] = dx_proj || [0, 0];

    const is_hovered =
        spot.id == hovered_spot.id ||
        spot.id == pinned_spot ||
        spot.band == hovered_band ||
        current_freq_spots.includes(spot.id);
    const dx_size = is_hovered ? 14 : 10;

    const color = colors.bands[spot.band];
    const light_color = colors.light_bands[spot.band];

    let style;
    if (spot.is_alerted) {
        style = {
            strokeDasharray: 5,
            strokeDashoffset: 50,
            animation: "dash 2s linear forwards infinite",
        };
    } else {
        style = {};
    }

    function on_click(event) {
        switch (event.detail) {
            case 1:
                set_pinned_spot(spot.id);
                break;
            case 2:
                set_cat_to_spot(spot);
                break;
        }
    }

    let symbol_component;
    if (spot.mode === "SSB") {
        symbol_component = (
            <rect
                x={dx_x - dx_size / 2}
                y={dx_y - dx_size / 2}
                width={dx_size}
                height={dx_size}
                fill={color}
                stroke="grey"
                strokeWidth="1px"
                onClick={() => set_cat_to_spot(spot)}
            />
        );
    } else if (spot.mode === "CW") {
        symbol_component = (
            <Triangle
                dx_x={dx_x}
                dx_y={dx_y}
                dx_size={dx_size}
                color={color}
                handleClick={() => set_cat_to_spot(spot)}
            />
        );
    } else {
        symbol_component = (
            <Hexagon
                dx_x={dx_x}
                dx_y={dx_y}
                dx_size={dx_size}
                color={color}
                handleClick={() => set_cat_to_spot(spot)}
            />
        );
    }

    return (
        <g
            onMouseOver={() => set_hovered_spot({ source: "arc", id: spot.id })}
            onMouseLeave={() => set_hovered_spot({ source: null, id: null })}
            onClick={on_click}
            className="hover:cursor-pointer"
        >
            {spotter_visible && dx_visible && (
                <>
                    <path
                        fill="none"
                        stroke={is_hovered ? light_color : color}
                        strokeWidth={is_hovered ? "6px" : "2px"}
                        d={path_generator(line)}
                        style={style}
                    />
                    <path
                        fill="none"
                        opacity="0"
                        strokeWidth="8px"
                        stroke="#FFFFFF"
                        d={path_generator(line)}
                    />
                    {spot.is_alerted ? (
                        <style>
                            {`
                @keyframes dash {
                    to {
                        stroke-dashoffset: 0;
                    }
                }
            `}
                        </style>
                    ) : (
                        ""
                    )}
                </>
            )}
            {spotter_visible && (
                <circle
                    r={is_hovered ? 5 : 3}
                    fill={color}
                    stroke="grey"
                    cx={spotter_x}
                    cy={spotter_y}
                    onClick={() => set_cat_to_spot(spot)}
                    onMouseOver={e => {
                        e.stopPropagation();
                        set_hovered_spot({ source: "spotter", id: spot.id });
                    }}
                ></circle>
            )}
            {dx_visible && (
                <g
                    onMouseOver={event => {
                        event.stopPropagation();
                        set_hovered_spot({ source: "dx", id: spot.id });
                    }}
                    onMouseLeave={event => {
                        set_hovered_spot({ source: null, id: null });
                    }}
                >
                    {symbol_component}
                </g>
            )}
        </g>
    );
}

export default Spot;

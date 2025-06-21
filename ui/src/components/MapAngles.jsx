import { to_radian } from "@/utils.js";
import { useMediaQuery } from "@uidotdev/usehooks";
import { useColors } from "../hooks/useColors";

function MapAngles({ radius, center_x, center_y, degrees_diff }) {
    const { colors } = useColors();

    const angle_labels = Array.from(Array(Math.round(360 / degrees_diff)).keys()).map(x => {
        const angle_degrees = x * degrees_diff;
        const angle_radians = to_radian(angle_degrees - 90);
        return [
            angle_degrees,
            [
                Math.cos(angle_radians) * radius + center_x,
                Math.sin(angle_radians) * radius + center_y,
            ],
        ];
    });

    const is_md_device = useMediaQuery("only screen and (min-width : 640px)");

    return is_md_device ? (
        <g>
            {angle_labels.map(([label, [x, y]]) => (
                <text
                    key={label}
                    dominantBaseline="middle"
                    textAnchor="middle"
                    x={x}
                    y={y}
                    fontSize="18px"
                    fill={colors.theme.text}
                >
                    {label}°
                </text>
            ))}
        </g>
    ) : (
        ""
    );
}

export default MapAngles;

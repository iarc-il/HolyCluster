import { to_radian } from "@/utils.js";
import { useMediaQuery } from "@uidotdev/usehooks";
import { useColors } from "../hooks/useColors";

function MapAngles({ radius, center_x, center_y, degrees_diff, hovered_azimuth }) {
    const { colors } = useColors();

    const generate_angles = () => {
        const angles = Array.from(Array(Math.round(360 / degrees_diff)).keys()).map(
            x => x * degrees_diff,
        );

        if (hovered_azimuth !== null) {
            let closest_angle =
                Math.round(Math.round(hovered_azimuth) / degrees_diff) * degrees_diff;
            return angles.map(angle => (closest_angle == angle ? hovered_azimuth : angle));
        } else {
            return angles;
        }
    };

    const angle_labels = generate_angles().map(angle_degrees => {
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
                    fontWeight={label === hovered_azimuth ? "bold" : "normal"}
                >
                    {Math.round(label)}°
                </text>
            ))}
        </g>
    ) : (
        ""
    );
}

export default MapAngles;

import { useColors } from "@/hooks/useColors";
import { to_radian } from "@/utils.js";
import { useMediaQuery } from "@uidotdev/usehooks";

const MAX_FONT_SIZE_PX = 18;
const MIN_FONT_SIZE_PX = 8;
const MAX_LABEL_WIDTH_EM = 2.6;
const LABEL_GAP_RATIO = 0.9;

function get_font_size(radius, degrees_diff) {
    const adjacent_label_spacing = radius * Math.sin(to_radian(degrees_diff));
    return Math.min(
        MAX_FONT_SIZE_PX,
        (adjacent_label_spacing * LABEL_GAP_RATIO) / MAX_LABEL_WIDTH_EM,
    );
}

function MapAngles({ radius, center_x, center_y, degrees_diff, hovered_azimuth }) {
    const { colors } = useColors();
    const is_md_device = useMediaQuery("only screen and (min-width : 640px)");
    const font_size = get_font_size(radius, degrees_diff);

    if (!is_md_device || font_size < MIN_FONT_SIZE_PX) return null;

    const generate_angles = () => {
        const angles = Array.from(Array(Math.round(360 / degrees_diff)).keys()).map(
            x => x * degrees_diff,
        );

        if (hovered_azimuth !== null) {
            let closest_angle =
                Math.round(Math.round(hovered_azimuth) / degrees_diff) * degrees_diff;
            closest_angle %= 360;
            return angles.map(angle => (closest_angle === angle ? hovered_azimuth : angle));
        }
        return angles;
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

    return (
        <g>
            {angle_labels.map(([label, [x, y]]) => (
                <text
                    key={label}
                    dominantBaseline="middle"
                    textAnchor="middle"
                    x={x}
                    y={y}
                    fontSize={`${font_size}px`}
                    fill={colors.theme.text}
                    fontWeight={label === hovered_azimuth ? "bold" : "normal"}
                >
                    {Math.round(label)}°
                </text>
            ))}
        </g>
    );
}

export default MapAngles;

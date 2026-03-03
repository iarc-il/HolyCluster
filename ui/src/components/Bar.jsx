import React from "react";

import { useColors } from "@/hooks/useColors";

const Bar = ({
    value,
    label,
    min = 0,
    max = 100,
    low_mid = 33,
    mid_high = 75,
    reverse_colors = false,
}) => {
    // Clamp the value between min and max
    const clamped_value = Math.max(min, Math.min(max, value));

    // Calculate the percentage relative to the range
    const percentage = ((clamped_value - min) / (max - min)) * 100;

    // Calculate dynamic color (green to red or red to green based on reverseColors)
    //const hue = reverse_colors ? percentage : 100 - percentage;
    //const color = `hsl(${hue}, 100%, 50%)`;

    const { colors } = useColors();

    const getBarColor = percentage => {
        if (percentage <= (100 * low_mid) / (max - min)) {
            return reverse_colors ? "red" : "green";
        } else if (
            percentage > (100 * low_mid) / (max - min) &&
            percentage <= (100 * mid_high) / (max - min)
        ) {
            return "orange";
        } else if (percentage > (100 * mid_high) / (max - min)) {
            return reverse_colors ? "green" : "red";
        }
    };

    return (
        <div className="flex flex-col items-center m-0">
            <span className="text-sm" style={{ color: colors.theme.text }}>
                {label}
            </span>
            <div className="flex justify-center items-end w-8 h-20 border border-gray-300 rounded-lg bg-gray-100 p-1">
                <div
                    className=" w-2 transition-all duration-300 mr-0.5 border border-solid border-gray-900"
                    style={{
                        height: `100%`,
                        background: reverse_colors
                            ? `linear-gradient(to top, red ${(100 * low_mid) / (max - min)}%, orange ${(100 * low_mid) / (max - min)}% ${(100 * mid_high) / (max - min)}%, green ${(100 * mid_high) / (max - min)}%)`
                            : `linear-gradient(to top, green ${(100 * low_mid) / (max - min)}%, orange ${(100 * low_mid) / (max - min)}% ${(100 * mid_high) / (max - min)}%, red ${(100 * mid_high) / (max - min)}%)`,
                    }}
                ></div>
                <div
                    className=" w-4 transition-all duration-300"
                    style={{
                        height: `${percentage}%`,
                        background: `${getBarColor(percentage)}`,
                        opacity: "90%",
                    }}
                ></div>
            </div>
            <span className="mt-1 text-sm" style={{ color: colors.theme.text }}>
                {value}
            </span>
        </div>
    );
};

export default Bar;

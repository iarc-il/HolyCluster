import React from "react";
import { useColors } from "../hooks/useColors";

export default function SevenSegmentDisplay({ className, height, value, display_size, error }) {
    const { colors } = useColors();

    if (!value) {
        error = true;
    } else {
        value = value.toString().padStart(display_size, "0");
    }

    return (
        <div className={`flex flex-row gap-2 h-[35px]`}>
            {Array.from({ length: display_size }, (_, i) => (
                <React.Fragment key={i}>
                    <SevenSegmentTile value={error ? -1 : parseInt(value[i])} />
                    {(display_size - i) % 3 === 1 && i !== display_size - 1 && (
                        <div
                            className={`h-[3px] aspect-square mt-auto -mx-1 ${error && "opacity-25"}`}
                            style={{
                                backgroundColor: error
                                    ? colors.seven_segment.off
                                    : colors.seven_segment.on,
                            }}
                        ></div>
                    )}
                </React.Fragment>
            ))}
        </div>
    );
}

function SevenSegmentTile({ className, value }) {
    const top_segment = [0, 2, 3, 5, 6, 7, 8, 9].includes(value);
    const top_left_segment = [0, 4, 5, 6, 8, 9].includes(value);
    const top_right_segment = [0, 1, 2, 3, 4, 7, 8, 9].includes(value);
    const middle_segment = [2, 3, 4, 5, 6, 8, 9, -1].includes(value);
    const bottom_left_segment = [0, 2, 6, 8].includes(value);
    const bottom_right_segment = [0, 1, 3, 4, 5, 6, 7, 8, 9].includes(value);
    const bottom_segment = [0, 2, 3, 5, 6, 8].includes(value);

    return (
        <div className={`relative aspect-[1/2] ${className}`}>
            <SevenSegmentLine className={"left-[10%] top-0 w-[80%] h-[10%]"} on={top_segment} />

            <SevenSegmentLine
                className={`left-[0%] top-[10%] w-[20%] h-[35%]`}
                on={top_left_segment}
            />
            <SevenSegmentLine
                className={`right-[0%] top-[10%] w-[20%] h-[35%]`}
                on={top_right_segment}
            />

            <SevenSegmentLine
                className={`left-[10%] top-[45%] w-[80%] h-[10%]`}
                on={middle_segment}
            />

            <SevenSegmentLine
                className={`left-[0%] top-[55%] w-[20%] h-[35%]`}
                on={bottom_left_segment}
            />
            <SevenSegmentLine
                className={`right-[0%] top-[55%] w-[20%] h-[35%] `}
                on={bottom_right_segment}
            />

            <SevenSegmentLine
                className={`left-[10%] top-[90%] w-[80%] h-[10%]`}
                on={bottom_segment}
            />
        </div>
    );
}

function SevenSegmentLine({ className, on }) {
    const { colors } = useColors();

    return (
        <span
            className={`absolute rounded-md ${className} ${!on && "opacity-25"}`}
            style={{
                backgroundColor: on ? colors.seven_segment.on : colors.seven_segment.off,
            }}
        />
    );
}

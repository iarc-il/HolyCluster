export default function SevenSegmentDisplay({ className, height, value, display_size, error }) {
    if (!value) {
        error = true;
    } else {
        value = value.toString().padStart(display_size, "0");
    }

    return (
        <div className={`flex flex-row gap-2 ${className || ""}`}>
            {Array.from({ length: display_size }, (_, i) => (
                <SevenSegmentTile
                    key={i}
                    className={`h-[${height}px]`}
                    value={error ? -1 : parseInt(value[i])}
                />
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
            <span
                className={`absolute left-[10%] top-0 w-[80%] h-[10%] rounded-md ${
                    top_segment ? "bg-red-500" : "bg-slate-200 opacity-25"
                }`}
            />

            <span
                className={`absolute left-[0%] top-[10%] w-[20%] h-[35%] rounded-md ${
                    top_left_segment ? "bg-red-500" : "bg-slate-200 opacity-25"
                }`}
            />
            <span
                className={`absolute right-[0%] top-[10%] w-[20%] h-[35%] rounded-md ${
                    top_right_segment ? "bg-red-500" : "bg-slate-200 opacity-25"
                }`}
            />

            <span
                className={`absolute left-[10%] top-[45%] w-[80%] h-[10%] rounded-md ${
                    middle_segment ? "bg-red-500" : "bg-slate-200 opacity-25"
                }`}
            />

            <span
                className={`absolute left-[0%] top-[55%] w-[20%] h-[35%] rounded-md ${
                    bottom_left_segment ? "bg-red-500" : "bg-slate-200 opacity-25"
                }`}
            />
            <span
                className={`absolute right-[0%] top-[55%] w-[20%] h-[35%] rounded-md ${
                    bottom_right_segment ? "bg-red-500" : "bg-slate-200 opacity-25"
                }`}
            />

            <span
                className={`absolute left-[10%] top-[90%] w-[80%] h-[10%] rounded-md ${
                    bottom_segment ? "bg-red-500" : "bg-slate-200 opacity-25"
                }`}
            />
        </div>
    );
}

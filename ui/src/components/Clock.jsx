import { useColors } from "@/hooks/useColors";
import { useTimeZone } from "@/hooks/useTimeZone";
import { useServerClock } from "@/hooks/useWs";
import { useEffect, useState } from "react";

function clock() {
    const { colors } = useColors();
    const { time_zone, toggle_time_zone, label, format_time } = useTimeZone();
    const { now_ms, clock_revision } = useServerClock();
    const [time, set_current_time] = useState(() => new Date(now_ms()));

    useEffect(() => {
        set_current_time(new Date(now_ms()));
        const interval_id = setInterval(() => set_current_time(new Date(now_ms())), 1000);
        return () => {
            clearInterval(interval_id);
        };
    }, [clock_revision, now_ms]);

    return (
        <button
            type="button"
            className="hidden 2xs:flex items-center justify-center text-center font-bold text-xl min-w-18 whitespace-nowrap cursor-pointer"
            data-tour="top-bar-clock"
            title={time_zone === "local" ? "Click to show UTC" : "Click to show local time"}
            onClick={toggle_time_zone}
            style={{ color: colors.theme.text }}
        >
            {`${format_time(time)} ${label}`}
        </button>
    );
}

export default clock;

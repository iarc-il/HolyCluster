import { useColors } from "@/hooks/useColors";
import { useTimeZone } from "@/hooks/useTimeZone";
import { useEffect, useState } from "react";

function clock() {
    const { colors } = useColors();
    const { time_zone, toggle_time_zone, label, to_string } = useTimeZone();
    const [time, set_current_time] = useState(new Date());

    useEffect(() => {
        const interval_id = setInterval(() => set_current_time(new Date()), 1000);
        return () => {
            clearInterval(interval_id);
        };
    }, []);

    return (
        <button
            type="button"
            className="hidden 2xs:flex items-center justify-center text-center font-bold text-xl min-w-18 whitespace-nowrap cursor-pointer"
            data-tour="top-bar-clock"
            title={time_zone === "local" ? "Click to show UTC" : "Click to show local time"}
            onClick={toggle_time_zone}
            style={{ color: colors.theme.text }}
        >
            {`${to_string(time).slice(13, 18)} ${label}`}
        </button>
    );
}

export default clock;

import { useState, useEffect } from "react";
import { useColors } from "@/hooks/useColors";

function clock() {
    const { colors } = useColors();
    const [time, set_current_time] = useState(new Date());

    useEffect(() => {
        let interval_id = setInterval(() => set_current_time(new Date()), 1000);
        return () => {
            clearInterval(interval_id);
        };
    });

    function pad(number) {
        return number.toString().padStart(2, "0");
    }
    return (
        <div
            className="hidden 2xs:flex items-center text-center font-bold text-xl min-w-18"
            style={{ color: colors.theme.text }}
        >
            {`${pad(time.getUTCHours())}:${pad(time.getUTCMinutes())} UTC`}
        </div>
    );
}

export default clock;

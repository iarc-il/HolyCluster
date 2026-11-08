import { useLocalStorage } from "@uidotdev/usehooks";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

const TimeZoneContext = createContext(undefined);

// Browsers have no time zone change event, so the offset is polled. This also catches DST transitions.
const OFFSET_POLL_MS = 60_000;

function getTimezoneOffsetLabel(offset) {
    return `UTC ${offset < 0 ? "+" : "-"}${Math.floor(Math.abs(offset) / 60)
        .toString()
        .padStart(2, "0")}:${(Math.abs(offset) % 60).toString().padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two_digits = value => value.toString().padStart(2, "0");
const format_time = (hours, minutes) => `${two_digits(hours)}:${two_digits(minutes)}`;
const format_date = (day, month) => `${two_digits(day)} ${MONTHS[month]}`;

const UTC = {
    label: "UTC",
    offset_ms: () => 0,
    hours: date => date.getUTCHours(),
    minutes: date => date.getUTCMinutes(),
    format_time: date => format_time(date.getUTCHours(), date.getUTCMinutes()),
    format_date: date => format_date(date.getUTCDate(), date.getUTCMonth()),
};

const LOCAL = {
    // Offset in effect at `date`, positive east of UTC
    // Subtracting from 0 avoids returning -0 in zones with no offset
    offset_ms: date => 0 - date.getTimezoneOffset() * 60_000,
    hours: date => date.getHours(),
    minutes: date => date.getMinutes(),
    format_time: date => format_time(date.getHours(), date.getMinutes()),
    format_date: date => format_date(date.getDate(), date.getMonth()),
};

export function useTimeZone() {
    const context = useContext(TimeZoneContext);
    if (context === undefined) {
        throw new Error("useTimeZone must be used within a TimeZoneProvider");
    }
    return context;
}

export function TimeZoneProvider({ children }) {
    const [time_zone, set_time_zone] = useLocalStorage("time_zone", "utc");
    const [offset, set_offset] = useState(() => new Date().getTimezoneOffset());

    useEffect(() => {
        // Setting the same number is a no-op, so nothing re-renders unless the offset changed.
        const check_offset = () => set_offset(new Date().getTimezoneOffset());
        const interval_id = setInterval(check_offset, OFFSET_POLL_MS);
        window.addEventListener("focus", check_offset);
        document.addEventListener("visibilitychange", check_offset);
        return () => {
            clearInterval(interval_id);
            window.removeEventListener("focus", check_offset);
            document.removeEventListener("visibilitychange", check_offset);
        };
    }, []);

    const value = useMemo(
        () => ({
            ...(time_zone === "local" ? { ...LOCAL, label: getTimezoneOffsetLabel(offset) } : UTC),
            time_zone,
            toggle_time_zone: () => set_time_zone(time_zone === "local" ? "utc" : "local"),
        }),
        [time_zone, set_time_zone, offset],
    );

    return <TimeZoneContext.Provider value={value}>{children}</TimeZoneContext.Provider>;
}

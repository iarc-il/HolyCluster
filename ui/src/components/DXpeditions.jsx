import { useMemo } from "react";
import { useLocalStorage } from "@uidotdev/usehooks";
import { useColors } from "@/hooks/useColors";
import { useServerData } from "@/hooks/useServerData";

const sort_options = [
    { key: "start", label: "Start" },
    { key: "end", label: "End" },
    { key: "time_left", label: "Time left" },
];

const sort_functions = {
    start: (a, b) => new Date(a.start_date) - new Date(b.start_date),
    end: (a, b) => new Date(a.end_date) - new Date(b.end_date),
    time_left: (a, b) => new Date(a.end_date) - new Date(b.end_date),
};

function format_duration(diff_ms) {
    const days = Math.floor(diff_ms / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff_ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h`;

    const minutes = Math.floor((diff_ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${minutes}m`;
}

function format_time_remaining(end_date) {
    const diff_ms = new Date(end_date) - new Date();
    if (diff_ms <= 0) return "Ended";
    return `${format_duration(diff_ms)} left`;
}

function format_time_until_start(start_date) {
    const diff_ms = new Date(start_date) - new Date();
    if (diff_ms <= 0) return null;
    return `in ${format_duration(diff_ms)}`;
}

function format_date(date_string) {
    const date = new Date(date_string);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function progress_fraction(start_date, end_date) {
    const now = new Date();
    const start = new Date(start_date);
    const end = new Date(end_date);
    const total = end - start;
    if (total <= 0) return 1;
    const elapsed = now - start;
    return Math.max(0, Math.min(1, elapsed / total));
}

function is_active(dxpedition) {
    const now = new Date();
    return now >= new Date(dxpedition.start_date) && now <= new Date(dxpedition.end_date);
}

function DXpeditionCard({ dxpedition, colors, is_spotted }) {
    const active = is_active(dxpedition);
    const fraction = progress_fraction(dxpedition.start_date, dxpedition.end_date);
    const time_remaining = format_time_remaining(dxpedition.end_date);
    const time_until_start = format_time_until_start(dxpedition.start_date);
    const is_ended = time_remaining === "Ended";
    const is_urgent = fraction > 0.85 && !is_ended;
    const badge_text = active ? time_remaining : time_until_start || time_remaining;

    return (
        <div
            className="rounded-lg p-3 flex flex-col gap-1.5"
            style={{
                backgroundColor: colors.theme.columns,
                border: is_spotted
                    ? "2px solid #FFD700"
                    : is_urgent
                      ? "1px solid #f59e0b"
                      : active
                        ? "1px solid #22c55e"
                        : `1px solid ${colors.theme.border || "#e2e8f0"}`,
                opacity: is_ended ? 0.5 : active ? 1 : 0.7,
            }}
        >
            <div className="flex items-center justify-between">
                <span
                    className="font-bold text-sm flex items-center gap-1.5"
                    style={{ color: colors.theme.text }}
                >
                    {is_spotted && <span title="Spotted now">⭐</span>}
                    {!is_spotted && active && (
                        <span
                            className="inline-block w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: "#22c55e" }}
                        />
                    )}
                    {dxpedition.callsign}
                </span>
                <span
                    className="text-xs font-medium px-1.5 py-0.5 rounded"
                    style={{
                        backgroundColor: is_ended
                            ? "#6b7280"
                            : is_urgent
                              ? "#f59e0b"
                              : active
                                ? "#22c55e"
                                : "#6b7280",
                        color: "white",
                    }}
                >
                    {badge_text}
                </span>
            </div>
            <div
                className="text-xs"
                style={{ color: colors.theme.text_secondary || colors.theme.text }}
            >
                {format_date(dxpedition.start_date)} – {format_date(dxpedition.end_date)}
            </div>
            {active && (
                <div
                    className="w-full h-1.5 rounded-full overflow-hidden mt-0.5"
                    style={{ backgroundColor: colors.theme.background }}
                >
                    <div
                        className="h-full rounded-full transition-all"
                        style={{
                            width: `${fraction * 100}%`,
                            backgroundColor: is_ended
                                ? "#6b7280"
                                : is_urgent
                                  ? "#f59e0b"
                                  : "#FFD700",
                        }}
                    />
                </div>
            )}
        </div>
    );
}

function DXpeditions() {
    const { colors } = useColors();
    const { raw_spots, dxpeditions } = useServerData();

    const [sort_key, set_sort_key] = useLocalStorage("dxpeditions_sort", "end");

    const spotted_callsigns = useMemo(() => {
        const callsigns = new Set();
        for (const spot of raw_spots) {
            if (spot.is_dxpedition) {
                callsigns.add(spot.dx_callsign);
            }
        }
        return callsigns;
    }, [raw_spots]);

    const sorted_dxpeditions = useMemo(() => {
        const sort_fn = sort_functions[sort_key] || sort_functions.end;
        return [...dxpeditions].sort(sort_fn);
    }, [dxpeditions, sort_key]);

    const active_count = useMemo(
        () => sorted_dxpeditions.filter(is_active).length,
        [sorted_dxpeditions],
    );
    const upcoming_count = sorted_dxpeditions.length - active_count;

    if (sorted_dxpeditions.length === 0) {
        return (
            <div className="p-4 text-center text-sm" style={{ color: colors.theme.text }}>
                No active DXpeditions
            </div>
        );
    }

    return (
        <div className="p-2 flex flex-col gap-2 overflow-y-auto h-full">
            <div className="flex items-center justify-between px-1">
                <div className="text-xs font-medium" style={{ color: colors.theme.text }}>
                    {active_count} active{upcoming_count > 0 && `, ${upcoming_count} upcoming`}
                </div>
                <div className="flex gap-1">
                    {sort_options.map(option => (
                        <button
                            key={option.key}
                            className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer"
                            style={{
                                backgroundColor: sort_key === option.key ? "#6b7280" : "transparent",
                                color: sort_key === option.key ? "white" : colors.theme.text,
                                border: sort_key === option.key ? "none" : `1px solid ${colors.theme.border || "#e2e8f0"}`,
                            }}
                            onClick={() => set_sort_key(option.key)}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>
            {sorted_dxpeditions.map(dxpedition => (
                <DXpeditionCard
                    key={dxpedition.callsign}
                    dxpedition={dxpedition}
                    colors={colors}
                    is_spotted={spotted_callsigns.has(dxpedition.callsign)}
                />
            ))}
        </div>
    );
}

export default DXpeditions;

import { useState, useEffect, useMemo } from "react";
import { useColors } from "@/hooks/useColors";

function format_time_remaining(end_date) {
    const now = new Date();
    const end = new Date(end_date);
    const diff_ms = end - now;

    if (diff_ms <= 0) return "Ended";

    const days = Math.floor(diff_ms / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff_ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) return `${days}d ${hours}h left`;
    if (hours > 0) return `${hours}h left`;

    const minutes = Math.floor((diff_ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${minutes}m left`;
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

function DXpeditionCard({ dxpedition, colors }) {
    const active = is_active(dxpedition);
    const fraction = progress_fraction(dxpedition.start_date, dxpedition.end_date);
    const time_remaining = format_time_remaining(dxpedition.end_date);
    const is_ended = time_remaining === "Ended";
    const is_urgent = fraction > 0.85 && !is_ended;

    return (
        <div
            className="rounded-lg p-3 flex flex-col gap-1.5"
            style={{
                backgroundColor: colors.theme.columns,
                border: is_urgent
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
                    {active && (
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
                    {time_remaining}
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
    const [dxpeditions, set_dxpeditions] = useState([]);
    const [loading, set_loading] = useState(true);

    useEffect(() => {
        const fetch_dxpeditions = () => {
            if (!navigator.onLine) return;

            fetch("/dxpeditions")
                .then(response => (response.ok ? response.json() : Promise.reject(response)))
                .then(data => {
                    set_dxpeditions(data || []);
                    set_loading(false);
                })
                .catch(() => set_loading(false));
        };

        fetch_dxpeditions();
        const interval_id = setInterval(fetch_dxpeditions, 3600 * 1000);
        return () => clearInterval(interval_id);
    }, []);

    const sorted_dxpeditions = useMemo(() => {
        return [...dxpeditions].sort((a, b) => new Date(a.end_date) - new Date(b.end_date));
    }, [dxpeditions]);

    if (loading) {
        return (
            <div className="p-4 text-center text-sm" style={{ color: colors.theme.text }}>
                Loading...
            </div>
        );
    }

    if (sorted_dxpeditions.length === 0) {
        return (
            <div className="p-4 text-center text-sm" style={{ color: colors.theme.text }}>
                No active DXpeditions
            </div>
        );
    }

    return (
        <div className="p-2 flex flex-col gap-2 overflow-y-auto h-full">
            <div className="text-xs font-medium px-1" style={{ color: colors.theme.text }}>
                {sorted_dxpeditions.length} active DXpedition
                {sorted_dxpeditions.length !== 1 && "s"}
            </div>
            {sorted_dxpeditions.map(dxpedition => (
                <DXpeditionCard key={dxpedition.callsign} dxpedition={dxpedition} colors={colors} />
            ))}
        </div>
    );
}

export default DXpeditions;

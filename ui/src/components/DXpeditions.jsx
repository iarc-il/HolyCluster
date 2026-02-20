import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalStorage } from "@uidotdev/usehooks";
import { useColors } from "@/hooks/useColors";
import { useSpotData } from "@/hooks/useSpotData";
import { useSpotInteraction } from "@/hooks/useSpotInteraction";
import { useRestData } from "@/hooks/useRestData";
import Popup from "@/components/Popup";

const filter_options = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "upcoming", label: "Upcoming" },
];

const sort_options = [
    { key: "start", label: "Start" },
    { key: "end", label: "End" },
    { key: "on_air", label: "On Air" },
];

const sort_functions = {
    start: (a, b) => new Date(a.start_date) - new Date(b.start_date),
    end: (a, b) => new Date(a.end_date) - new Date(b.end_date),
};

function format_duration(diff_ms) {
    const days = Math.floor(diff_ms / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff_ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) return `${days}D ${hours}H`;
    if (hours > 0) return `${hours}H`;

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

function OnAirStar({ colors }) {
    const star_ref = useRef(null);
    const [is_hovered, set_is_hovered] = useState(false);

    return (
        <>
            <span
                ref={star_ref}
                onMouseEnter={_ => set_is_hovered(true)}
                onMouseLeave={_ => set_is_hovered(false)}
            >
                ⭐
            </span>
            {is_hovered && (
                <Popup anchor_ref={star_ref}>
                    <div
                        className="py-0 px-2 h-[24px] whitespace-nowrap rounded shadow-lg"
                        style={{
                            color: colors.theme.text,
                            background: colors.theme.background,
                        }}
                    >
                        On Air
                    </div>
                </Popup>
            )}
        </>
    );
}

function DXpeditionCard({
    dxpedition,
    colors,
    is_spotted,
    is_highlighted,
    card_ref,
    onMouseEnter,
    onMouseLeave,
}) {
    const active = is_active(dxpedition);
    const fraction = progress_fraction(dxpedition.start_date, dxpedition.end_date);
    const time_remaining = format_time_remaining(dxpedition.end_date);
    const time_until_start = format_time_until_start(dxpedition.start_date);
    const is_ended = time_remaining === "Ended";
    const is_urgent = fraction > 0.85 && !is_ended;
    const badge_text = active ? time_remaining : time_until_start || time_remaining;

    return (
        <div
            ref={card_ref}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            className="rounded-lg p-3 flex flex-col gap-1.5 border-2 transition-all duration-200"
            style={{
                backgroundColor: is_highlighted ? "#2a44a8" : colors.theme.columns,
                borderColor: is_highlighted ? "#4a6af5" : colors.dxpeditions.borders,
                opacity: active || is_highlighted ? 1 : 0.7,
                color: is_highlighted ? "white" : undefined,
            }}
        >
            <div className="flex items-center justify-between">
                <span
                    className="font-bold text-md flex items-center gap-1.5"
                    style={{ color: is_highlighted ? "white" : colors.theme.text }}
                >
                    {is_spotted && <OnAirStar colors={colors} />}
                    {dxpedition.callsign}
                </span>
                <span
                    className="text-md font-medium px-1.5 py-0.5 rounded"
                    style={{
                        backgroundColor: is_highlighted ? "rgba(255,255,255,0.2)" : "#2a44a8",
                        color: "white",
                    }}
                >
                    {badge_text}
                </span>
            </div>
            <div
                className="text-sm"
                style={{ color: is_highlighted ? "rgba(255,255,255,0.85)" : colors.theme.text }}
            >
                {format_date(dxpedition.start_date)} – {format_date(dxpedition.end_date)}
            </div>
            {active && (
                <div
                    className="w-full h-1.5 rounded-full overflow-hidden mt-0.5"
                    style={{ backgroundColor: colors.dxpeditions.progress_track }}
                >
                    <div
                        className="h-full rounded-full transition-all"
                        style={{
                            width: `${fraction * 100}%`,
                            backgroundColor: colors.dxpeditions.progress_bar,
                        }}
                    />
                </div>
            )}
        </div>
    );
}

function DXpeditions() {
    const { colors } = useColors();
    const { raw_spots } = useSpotData();
    const { hovered_spot, set_hovered_spot } = useSpotInteraction();
    const { dxpeditions } = useRestData();
    const card_refs = useRef({});

    const [sort_key, set_sort_key] = useLocalStorage("dxpeditions_sort", "end");
    const [filter_key, set_filter_key] = useLocalStorage("dxpeditions_filter", "all");

    const spotted_dxpedition_spots = useMemo(() => {
        const map = new Map();
        for (const spot of raw_spots) {
            if (spot.is_dxpedition) {
                for (const d of dxpeditions) {
                    if (spot.dx_callsign.startsWith(d.callsign)) {
                        const existing = map.get(d.id);
                        if (existing == null || spot.time > existing.time) {
                            map.set(d.id, { id: spot.id, time: spot.time });
                        }
                        break;
                    }
                }
            }
        }
        return map;
    }, [raw_spots, dxpeditions]);

    const spot_to_dxpedition = useMemo(() => {
        const map = new Map();
        for (const spot of raw_spots) {
            if (spot.is_dxpedition) {
                for (const d of dxpeditions) {
                    if (spot.dx_callsign.startsWith(d.callsign)) {
                        map.set(spot.id, d.id);
                        break;
                    }
                }
            }
        }
        return map;
    }, [raw_spots, dxpeditions]);

    const hovered_dxpedition_id = useMemo(() => {
        if (hovered_spot.dxpedition_id != null) return hovered_spot.dxpedition_id;
        if (hovered_spot.id == null) return null;
        const spot = raw_spots.find(s => s.id === hovered_spot.id);
        if (!spot || !spot.is_dxpedition) return null;
        const match = spot_to_dxpedition.get(spot.id);
        return match ?? null;
    }, [hovered_spot, raw_spots, spot_to_dxpedition]);

    useEffect(() => {
        if (hovered_dxpedition_id == null) return;
        if (hovered_spot.source === "dxpedition") return;
        const ref = card_refs.current[hovered_dxpedition_id];
        if (ref) {
            ref.scrollIntoView({ block: "center", behavior: "smooth" });
        }
    }, [hovered_dxpedition_id, hovered_spot.source]);

    const sorted_dxpeditions = useMemo(() => {
        const now = new Date();
        let filtered = [...dxpeditions].filter(d => new Date(d.end_date) >= now);
        if (filter_key === "active") {
            filtered = filtered.filter(is_active);
        } else if (filter_key === "upcoming") {
            filtered = filtered.filter(d => !is_active(d));
        }
        if (sort_key === "on_air") {
            filtered.sort((a, b) => {
                const a_spotted = spotted_dxpedition_spots.has(a.id) ? 1 : 0;
                const b_spotted = spotted_dxpedition_spots.has(b.id) ? 1 : 0;
                if (a_spotted !== b_spotted) return b_spotted - a_spotted;
                const a_active = is_active(a) ? 1 : 0;
                const b_active = is_active(b) ? 1 : 0;
                if (a_active !== b_active) return b_active - a_active;
                return new Date(a.end_date) - new Date(b.end_date);
            });
        } else {
            const sort_fn = sort_functions[sort_key] || sort_functions.end;
            filtered.sort(sort_fn);
        }
        return filtered;
    }, [dxpeditions, sort_key, filter_key, spotted_dxpedition_spots]);

    const active_count = useMemo(() => dxpeditions.filter(is_active).length, [dxpeditions]);
    const upcoming_count = dxpeditions.length - active_count;

    if (sorted_dxpeditions.length === 0) {
        return (
            <div className="p-4 text-center text-sm" style={{ color: colors.theme.text }}>
                No active DXpeditions
            </div>
        );
    }

    return (
        <div className="p-2 text-sm flex flex-col gap-2 overflow-y-auto h-full">
            <div className="flex flex-col gap-1 px-1">
                <div className="flex items-center justify-between">
                    <span style={{ color: colors.theme.text }}>
                        {active_count} active, {upcoming_count} upcoming
                    </span>
                </div>
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <span style={{ color: colors.theme.text, opacity: 0.6 }}>Filter:</span>
                        <div className="flex gap-2">
                            {filter_options.map(option => (
                                <button
                                    key={option.key}
                                    className="px-1 py-0.5 rounded cursor-pointer"
                                    style={{
                                        backgroundColor:
                                            filter_key === option.key ? "#2a44a8" : "transparent",
                                        color:
                                            filter_key === option.key ? "white" : colors.theme.text,
                                        border:
                                            filter_key === option.key
                                                ? "1px solid #4a6af5"
                                                : `1px solid ${colors.dxpeditions.borders}`,
                                    }}
                                    onClick={() => set_filter_key(option.key)}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center justify-between">
                        <span style={{ color: colors.theme.text, opacity: 0.6 }}>Sort:</span>
                        <div className="flex gap-2">
                            {sort_options.map(option => (
                                <button
                                    key={option.key}
                                    className="px-1 py-0.5 rounded cursor-pointer"
                                    style={{
                                        backgroundColor:
                                            sort_key === option.key ? "#2a44a8" : "transparent",
                                        color:
                                            sort_key === option.key ? "white" : colors.theme.text,
                                        border:
                                            sort_key === option.key
                                                ? "1px solid #4a6af5"
                                                : `1px solid ${colors.dxpeditions.borders}`,
                                    }}
                                    onClick={() => set_sort_key(option.key)}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            {sorted_dxpeditions.map(dxpedition => (
                <DXpeditionCard
                    key={dxpedition.id}
                    dxpedition={dxpedition}
                    colors={colors}
                    is_spotted={spotted_dxpedition_spots.has(dxpedition.id)}
                    is_highlighted={hovered_dxpedition_id === dxpedition.id}
                    onMouseEnter={() => {
                        const entry = spotted_dxpedition_spots.get(dxpedition.id);
                        if (entry != null) {
                            set_hovered_spot({
                                source: "dxpedition",
                                id: entry.id,
                                dxpedition_id: dxpedition.id,
                            });
                        }
                    }}
                    onMouseLeave={() => {
                        if (spotted_dxpedition_spots.has(dxpedition.id)) {
                            set_hovered_spot({ source: null, id: null });
                        }
                    }}
                    card_ref={element => {
                        if (element) card_refs.current[dxpedition.id] = element;
                        else delete card_refs.current[dxpedition.id];
                    }}
                />
            ))}
        </div>
    );
}

export default DXpeditions;

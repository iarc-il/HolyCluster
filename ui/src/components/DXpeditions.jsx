import { useEffect, useMemo, useRef, useState } from "react";
import { useLocalStorage } from "@uidotdev/usehooks";
import { useColors } from "@/hooks/useColors";
import { useSpotData } from "@/hooks/useSpotData";
import { useSpotInteraction } from "@/hooks/useSpotInteraction";
import { useRestData } from "@/hooks/useRestData";
import Popup from "@/components/Popup";

const sort_options = [
    { key: "start", label: "Start" },
    { key: "end", label: "End" },
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

    const hovered_dxpedition_id = useMemo(() => {
        if (hovered_spot.id == null) return null;
        const spot = raw_spots.find(s => s.id === hovered_spot.id);
        if (!spot || !spot.is_dxpedition) return null;
        const match = dxpeditions.find(
            d => spot.dx_callsign.startsWith(d.callsign) && is_active(d),
        );
        return match ? match.id : null;
    }, [hovered_spot.id, raw_spots, dxpeditions]);

    useEffect(() => {
        if (hovered_dxpedition_id == null) return;
        if (hovered_spot.source === "dxpedition") return;
        const ref = card_refs.current[hovered_dxpedition_id];
        if (ref) {
            ref.scrollIntoView({ block: "center", behavior: "smooth" });
        }
    }, [hovered_dxpedition_id, hovered_spot.source]);

    const spotted_dxpedition_spots = useMemo(() => {
        const map = new Map();
        for (const spot of raw_spots) {
            if (spot.is_dxpedition) {
                for (const d of dxpeditions) {
                    if (spot.dx_callsign.startsWith(d.callsign)) {
                        const existing = map.get(d.callsign);
                        if (existing == null || spot.time > existing.time) {
                            map.set(d.callsign, { id: spot.id, time: spot.time });
                        }
                        break;
                    }
                }
            }
        }
        return map;
    }, [raw_spots, dxpeditions]);

    const sorted_dxpeditions = useMemo(() => {
        const now = new Date();
        const sort_fn = sort_functions[sort_key] || sort_functions.end;
        return [...dxpeditions].filter(d => new Date(d.end_date) >= now).sort(sort_fn);
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
                <div className="text-sm font-medium" style={{ color: colors.theme.text }}>
                    {active_count} active
                    <br />
                    {upcoming_count} upcoming
                </div>
                {/*
                <div className="flex gap-1">
                    {sort_options.map(option => (
                        <button
                            key={option.key}
                            className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer"
                            style={{
                                backgroundColor:
                                    sort_key === option.key
                                        ? colors.dxpeditions.inactive
                                        : "transparent",
                                color:
                                    sort_key === option.key
                                        ? colors.dxpeditions.badge_text
                                        : colors.theme.text,
                                border:
                                    sort_key === option.key
                                        ? "none"
                                        : `1px solid ${colors.dxpeditions.fallback_border}`,
                            }}
                            onClick={() => set_sort_key(option.key)}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>*/}
            </div>
            {sorted_dxpeditions.map(dxpedition => (
                <DXpeditionCard
                    key={dxpedition.id}
                    dxpedition={dxpedition}
                    colors={colors}
                    is_spotted={spotted_dxpedition_spots.has(dxpedition.callsign)}
                    is_highlighted={hovered_dxpedition_id === dxpedition.id}
                    onMouseEnter={() => {
                        const entry = spotted_dxpedition_spots.get(dxpedition.callsign);
                        if (entry != null) {
                            set_hovered_spot({ source: "dxpedition", id: entry.id });
                        }
                    }}
                    onMouseLeave={() => {
                        if (spotted_dxpedition_spots.has(dxpedition.callsign)) {
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

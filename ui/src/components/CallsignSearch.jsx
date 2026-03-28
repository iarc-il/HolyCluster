import { useState } from "react";
import Input from "@/components/ui/Input.jsx";
import X from "@/components/ui/X.jsx";
import Toggle from "@/components/ui/Toggle.jsx";
import { useColors } from "@/hooks/useColors";
import { useSpotInteraction } from "@/hooks/useSpotInteraction";
import { useFilters } from "@/hooks/useFilters";
import { useReplay } from "@/hooks/useReplay";

const from_hours_options = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 18, 20, 24, 30, 36, 48, 72, 96, 120, 168];

export default function CallsignSearch() {
    const { colors } = useColors();
    const { search_query, set_search_query } = useSpotInteraction();
    const { callsign_filters, setCallsignFilters } = useFilters();
    const { load_search_spots, clear_search_spots, is_search_loading } = useReplay();

    const [search_enabled, set_search_enabled] = useState(false);
    const [from_hours, set_from_hours] = useState(24);

    const handle_toggle = () => {
        if (search_enabled) {
            set_search_enabled(false);
            clear_search_spots();
        } else {
            set_search_enabled(true);
            load_search_spots(from_hours);
        }
    };

    const handle_from_change = hours => {
        set_from_hours(hours);
        if (search_enabled) {
            load_search_spots(hours);
        }
    };

    const handle_enter = query => {
        const newFilter = {
            action: "show_only",
            type: "prefix",
            value: query.toUpperCase(),
            spotter_or_dx: "dx",
        };
        setCallsignFilters({
            ...callsign_filters,
            filters: [...callsign_filters.filters, newFilter],
        });
        set_search_query("");
    };

    return (
        <div
            className="hidden md:flex items-center gap-2 px-2 py-1 shrink-0"
            style={{ borderBottom: `1px solid ${colors.theme.borders}` }}
        >
            {/* Search input */}
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke={colors.theme.text} strokeWidth="2">
                <circle cx="6" cy="6" r="5" />
                <path d="M15 15L10 10" strokeLinecap="round" />
            </svg>
            <Input
                className="w-32 h-10 text-lg border-2"
                border_color={colors.table.header_arrow}
                placeholder="Search callsign..."
                value={search_query}
                onChange={e => set_search_query(e.target.value)}
                onKeyDown={e => {
                    if (e.key === "Enter" && search_query.trim()) {
                        handle_enter(search_query.trim());
                    }
                }}
            />
            {search_query && <X size="24" on_click={() => set_search_query("")} />}

            {/* Divider */}
            <div style={{ width: "1px", height: "24px", backgroundColor: colors.theme.borders, flexShrink: 0 }} />

            {/* Historical range toggle */}
            <div className="flex items-center gap-1.5">
                <span style={{ color: colors.theme.text, fontSize: "1.125rem" }}>
                    From
                </span>
                <select
                    value={from_hours}
                    disabled={!search_enabled}
                    onChange={e => handle_from_change(Number(e.target.value))}
                    style={{
                        backgroundColor: colors.theme.input_background,
                        color: colors.theme.text,
                        borderRadius: "0.375rem",
                        padding: "0.15rem 0.4rem",
                        fontSize: "1.125rem",
                        opacity: search_enabled ? 1 : 0.4,
                        cursor: search_enabled ? "pointer" : "default",
                    }}
                >
                    {from_hours_options.map(h => (
                        <option key={h} value={h}>{h}h ago</option>
                    ))}
                </select>
                {is_search_loading && (
                    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeOpacity="0.3" />
                        <path d="M12 2a10 10 0 0 1 10 10" stroke="white" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                )}
                <Toggle value={search_enabled} on_click={handle_toggle} />
            </div>
        </div>
    );
}

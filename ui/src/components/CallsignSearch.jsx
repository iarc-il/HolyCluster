import { useRef } from "react";
import Input from "@/components/ui/Input.jsx";
import X from "@/components/ui/X.jsx";
import { useColors } from "@/hooks/useColors";
import { useSpotInteraction } from "@/hooks/useSpotInteraction";
import { useFilters } from "@/hooks/useFilters";

export default function CallsignSearch() {
    const { colors } = useColors();
    const { search_query, set_search_query } = useSpotInteraction();
    const { callsign_filters, setCallsignFilters } = useFilters();

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
            className="hidden md:flex items-center gap-1.5 px-2 py-1 shrink-0"
            style={{
                borderBottom: `1px solid ${colors.theme.borders}`,
            }}
        >
            <svg
                width="24"
                height="24"
                viewBox="0 0 16 16"
                fill="none"
                stroke={colors.theme.text}
                strokeWidth="2"
            >
                <circle cx="6" cy="6" r="5" />
                <path d="M15 15L10 10" strokeLinecap="round" />
            </svg>
            <Input
                className={`w-48 h-10 text-lg border-2`}
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
        </div>
    );
}

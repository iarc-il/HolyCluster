import { useState, useRef } from "react";
import Input from "@/components/ui/Input.jsx";
import X from "@/components/ui/X.jsx";
import Toggle from "@/components/ui/Toggle.jsx";
import { useColors } from "@/hooks/useColors";
import { useSpotInteraction } from "@/hooks/useSpotInteraction";
import { useFilters } from "@/hooks/useFilters";
import { useReplay } from "@/hooks/useReplay";
import { useSettings } from "@/hooks/useSettings";

const from_hours_options = [
    { label: "6h", value: 6 },
    { label: "12h", value: 12 },
    { label: "24h", value: 24 },
    { label: "2D", value: 48 },
    { label: "3D", value: 72 },
];

export default function CallsignSearch() {
    const { colors } = useColors();
    const { search_query, set_search_query } = useSpotInteraction();
    const { callsign_filters, setCallsignFilters } = useFilters();
    const { search_callsign, clear_search_spots, is_search_loading } = useReplay();
    const { settings, set_settings } = useSettings();

    const [search_enabled, set_search_enabled] = useState(false);
    const [from_hours, set_from_hours] = useState(24);
    const search_timer_ref = useRef(null);

    const trigger_search = (query, hours) => {
        if (search_timer_ref.current) clearTimeout(search_timer_ref.current);
        search_timer_ref.current = setTimeout(() => search_callsign(query, hours), 300);
    };

    const handle_toggle = () => {
        if (search_enabled) {
            set_search_enabled(false);
            clear_search_spots();
        } else {
            set_search_enabled(true);
            if (search_query.trim()) {
                trigger_search(search_query.trim(), from_hours);
            }
        }
    };

    const handle_from_change = hours => {
        set_from_hours(hours);
        if (search_enabled && search_query.trim()) {
            trigger_search(search_query.trim(), hours);
        }
    };

    const handle_search_change = e => {
        const val = e.target.value;
        set_search_query(val);
        if (search_enabled) {
            trigger_search(val.trim(), from_hours);
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
        if (search_enabled) clear_search_spots();
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
            <div className="relative">
                <Input
                    className="w-32 h-10 text-lg border-2"
                    border_color={colors.table.header_arrow}
                    placeholder="Search callsign..."
                    value={search_query}
                    onChange={handle_search_change}
                    onKeyDown={e => {
                        if (e.key === "Enter" && search_query.trim()) {
                            handle_enter(search_query.trim());
                        }
                    }}
                />
                {is_search_loading && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        <svg className="animate-spin" width="22" height="22" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeOpacity="0.3" />
                            <path d="M12 2a10 10 0 0 1 10 10" stroke="white" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                    </div>
                )}
            </div>
            {search_query && <X size="32" on_click={() => { set_search_query(""); clear_search_spots(); }} />}

            {/* Divider */}
            <div style={{ width: "1px", height: "24px", backgroundColor: colors.theme.borders, flexShrink: 0 }} />

            {/* Historical range */}
            <div className="flex items-center gap-1.5">
                <span style={{ color: colors.theme.text, fontSize: "1.125rem" }}>From</span>
                <select
                    value={from_hours}
                    disabled={!search_enabled}
                    onChange={e => handle_from_change(Number(e.target.value))}
                    style={{
                        backgroundColor: colors.theme.input_background,
                        color: colors.theme.text,
                        borderRadius: "0.375rem",
                        padding: "0.15rem 0.3rem",
                        fontSize: "1.125rem",
                        width: "4.5rem",
                        opacity: search_enabled ? 1 : 0.4,
                    }}
                >
                    {from_hours_options.map(({ label, value }) => (
                        <option key={value} value={value}>{label}</option>
                    ))}
                </select>
                <Toggle value={search_enabled} on_click={handle_toggle} />
            </div>

            {/* Divider */}
            <div style={{ width: "1px", height: "24px", backgroundColor: colors.theme.borders, flexShrink: 0 }} />

            {/* Single spot per station toggle */}
            <div className="flex items-center gap-1.5 ml-auto">
                <div style={{ color: colors.theme.text, fontSize: "1.125rem", textAlign: "right", lineHeight: 1.2 }}>
                    <div>Single spot</div>
                    <div>per station</div>
                </div>
                <Toggle
                    value={settings.show_only_latest_spot}
                    on_click={() => set_settings({ ...settings, show_only_latest_spot: !settings.show_only_latest_spot })}
                />
            </div>
        </div>
    );
}

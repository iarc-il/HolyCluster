import { useRef, useState } from "react";
import Input from "@/components/ui/Input.jsx";
import X from "@/components/ui/X.jsx";
import Popup from "@/components/ui/Popup.jsx";
import { useColors } from "@/hooks/useColors";
import { useSpotInteraction } from "@/hooks/useSpotInteraction";
import { useFilters } from "@/hooks/useFilters";

export default function CallsignSearch() {
    const { colors } = useColors();
    const { search_query, set_search_query, is_pota_mode, set_is_pota_mode, set_pinned_spot } =
        useSpotInteraction();
    const { filters, setFilters, callsign_filters, setCallsignFilters } = useFilters();
    const single_spot = filters.show_only_latest_spot;
    const pota_mode_ref = useRef(null);
    const single_spot_ref = useRef(null);
    const [show_pota_popup, set_show_pota_popup] = useState(false);
    const [show_single_popup, set_show_single_popup] = useState(false);
    const [pota_mode_hover, set_pota_mode_hover] = useState(false);
    const [single_spot_hover, set_single_spot_hover] = useState(false);

    const toggle_button_base = {
        border: `1px solid ${colors.theme.text}38`,
        background: `${colors.theme.text}14`,
        transition: "background-color 140ms ease, border-color 140ms ease, color 140ms ease",
    };

    const toggle_button_active = {
        border: `1px solid ${colors.theme.text}80`,
        background: `${colors.theme.text}2E`,
    };

    const toggle_button_hover_style = {
        border: `1px solid ${colors.theme.text}66`,
        background: `${colors.theme.text}24`,
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
                placeholder={is_pota_mode ? "Search POTA..." : "Search callsign..."}
                value={search_query}
                onChange={e => set_search_query(e.target.value)}
                onKeyDown={e => {
                    if (e.key === "Enter" && search_query.trim()) {
                        handle_enter(search_query.trim());
                    }
                }}
            />
            {search_query && <X size="24" on_click={() => set_search_query("")} />}
            <button
                ref={pota_mode_ref}
                onClick={() => {
                    set_is_pota_mode(!is_pota_mode);
                    set_pinned_spot(null);
                }}
                onMouseEnter={() => {
                    set_show_pota_popup(true);
                    set_pota_mode_hover(true);
                }}
                onMouseLeave={() => {
                    set_show_pota_popup(false);
                    set_pota_mode_hover(false);
                }}
                className="ml-auto flex items-center gap-1 cursor-pointer rounded-md px-2 py-1"
                style={{
                    ...toggle_button_base,
                    ...(is_pota_mode ? toggle_button_active : {}),
                    ...(pota_mode_hover ? toggle_button_hover_style : {}),
                    color: is_pota_mode ? colors.buttons.utility : colors.theme.text,
                }}
            >
                <span className="text-xs font-bold tracking-wide">POTA</span>
            </button>
            {show_pota_popup && (
                <Popup anchor_ref={pota_mode_ref} keep_in_view={true}>
                    <div
                        className="py-1 px-2 rounded shadow-lg"
                        style={{
                            color: colors.theme.text,
                            background: colors.theme.background,
                        }}
                    >
                        POTA spots
                    </div>
                </Popup>
            )}
            <button
                ref={single_spot_ref}
                onClick={() =>
                    setFilters({
                        ...filters,
                        show_only_latest_spot: !filters.show_only_latest_spot,
                    })
                }
                onMouseEnter={() => {
                    set_show_single_popup(true);
                    set_single_spot_hover(true);
                }}
                onMouseLeave={() => {
                    set_show_single_popup(false);
                    set_single_spot_hover(false);
                }}
                className="flex items-center gap-1 cursor-pointer rounded-md px-2 py-1"
                style={{
                    ...toggle_button_base,
                    ...(single_spot ? toggle_button_active : {}),
                    ...(single_spot_hover ? toggle_button_hover_style : {}),
                }}
            >
                <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={single_spot ? colors.buttons.utility : colors.theme.text}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <rect
                        x="3"
                        y="3"
                        width="7"
                        height="7"
                        rx="1"
                        fill={single_spot ? colors.buttons.utility : "none"}
                    />
                    <rect
                        x="3"
                        y="14"
                        width="7"
                        height="7"
                        rx="1"
                        opacity={single_spot ? "0.3" : "1"}
                    />
                    <line x1="14" y1="6" x2="21" y2="6" opacity={single_spot ? "0.3" : "1"} />
                    <line x1="14" y1="17" x2="21" y2="17" opacity={single_spot ? "0.3" : "1"} />
                </svg>
            </button>
            {show_single_popup && (
                <Popup anchor_ref={single_spot_ref} keep_in_view={true}>
                    <div
                        className="py-1 px-2 rounded shadow-lg"
                        style={{
                            color: colors.theme.text,
                            background: colors.theme.background,
                        }}
                    >
                        Single spot per station
                    </div>
                </Popup>
            )}
        </div>
    );
}

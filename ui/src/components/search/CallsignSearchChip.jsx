import CallsignSearchModal from "@/components/search/CallsignSearchModal.jsx";
import Popup from "@/components/ui/Popup.jsx";
import Spinner from "@/components/ui/Spinner.jsx";
import { FROM_PRESETS } from "@/hooks/useCallsignSearch";
import { useColors } from "@/hooks/useColors";
import { useSpotData } from "@/hooks/useSpotData";
import { useTimeZone } from "@/hooks/useTimeZone";
import { useRef, useState } from "react";

const ERROR_COLOR = "#ef4444";
const WARNING_COLOR = "#f59e0b";

// Shows the active callsign history search next to the search button.
// Details that don't fit (counts, exact range, errors) go in the tooltip.
export default function CallsignSearchChip({ compact = false }) {
    const { colors } = useColors();
    const { format_date, format_time, label } = useTimeZone();
    const {
        callsign_search,
        set_callsign_search,
        search_fetch_state,
        search_error,
        search_truncated,
        spots,
        raw_spots,
    } = useSpotData();
    const chip_ref = useRef(null);
    const [is_hovered, set_is_hovered] = useState(false);

    if (!callsign_search) return null;

    const format = date => `${format_date(date)} ${format_time(date)}`;
    const exact_range = `${format(callsign_search.start)} – ${format(callsign_search.end)} (${label})`;
    const from_preset = FROM_PRESETS.find(p => p.value === callsign_search.from_preset);
    const range_text =
        callsign_search.to_preset === "now" && from_preset ? from_preset.summary : exact_range;

    const is_loading = search_fetch_state === "loading";
    const is_error = search_fetch_state === "error";
    const is_truncated = search_fetch_state === "done" && search_truncated;
    const hidden_count = raw_spots.length - spots.length;

    const tooltip_lines = [
        { text: `DX ${callsign_search.callsign}`, bold: true },
        { text: exact_range },
    ];
    if (is_loading) {
        tooltip_lines.push({ text: "Searching..." });
    } else if (is_error) {
        tooltip_lines.push({ text: `Search failed: ${search_error}`, color: ERROR_COLOR });
    } else {
        tooltip_lines.push({
            text: `${spots.length} spots shown${hidden_count > 0 ? ` · ${hidden_count} hidden by filters` : ""}`,
        });
        if (is_truncated) {
            // The server returns exactly its cap when it truncates
            tooltip_lines.push({
                text: `Showing newest ${raw_spots.length.toLocaleString()} spots — narrow the range to see older ones`,
                color: WARNING_COLOR,
            });
        }
    }

    let accent = `${colors.theme.text}80`;
    if (is_error) accent = ERROR_COLOR;
    else if (is_truncated) accent = WARNING_COLOR;

    return (
        <div
            ref={chip_ref}
            className="flex items-center shrink min-w-0 rounded-md text-sm"
            data-tour="callsign-search-chip"
            onMouseEnter={() => set_is_hovered(true)}
            onMouseLeave={() => set_is_hovered(false)}
            style={{
                border: `1px solid ${accent}`,
                background: `${colors.theme.text}2E`,
                color: colors.theme.text,
            }}
        >
            <CallsignSearchModal
                trigger_class_name="min-w-0"
                button={
                    <span
                        className={`flex items-center gap-1.5 min-w-0 ${compact ? "pl-1.5" : "pl-2"} py-1`}
                    >
                        {is_loading && <Spinner size="14" color={colors.theme.text} />}
                        <span className="font-semibold whitespace-nowrap">
                            {callsign_search.callsign}
                        </span>
                        {!compact && (
                            <span className="whitespace-nowrap truncate opacity-80">
                                · {range_text}
                            </span>
                        )}
                        {!is_loading && !is_error && (
                            <span
                                className="whitespace-nowrap opacity-80"
                                style={is_truncated ? { color: WARNING_COLOR } : undefined}
                            >
                                ({spots.length}
                                {is_truncated && "+"})
                            </span>
                        )}
                        {is_error && <span style={{ color: ERROR_COLOR }}>!</span>}
                    </span>
                }
            />
            <button
                type="button"
                className="flex items-center px-1.5 py-1 cursor-pointer opacity-80 hover:opacity-100"
                aria-label="Exit callsign search"
                onClick={() => set_callsign_search(null)}
            >
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={colors.theme.text}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                >
                    <path d="M6 6l12 12M18 6L6 18" />
                </svg>
            </button>
            {is_hovered && (
                <Popup anchor_ref={chip_ref} keep_in_view={true} vertical_offset={-4}>
                    <div
                        className="py-1 px-2 rounded shadow-lg text-xs"
                        role="tooltip"
                        style={{
                            color: colors.theme.text,
                            background: colors.theme.background,
                        }}
                    >
                        {tooltip_lines.map(line => (
                            <div
                                key={line.text}
                                className={line.bold ? "font-semibold" : undefined}
                                style={line.color ? { color: line.color } : undefined}
                            >
                                {line.text}
                            </div>
                        ))}
                    </div>
                </Popup>
            )}
        </div>
    );
}

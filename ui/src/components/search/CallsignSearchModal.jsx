import Input from "@/components/ui/Input.jsx";
import Modal from "@/components/ui/Modal.jsx";
import Select from "@/components/ui/Select.jsx";
import {
    FROM_PRESETS,
    MAX_SEARCH_RANGE_MS,
    normalize_search_callsign,
} from "@/hooks/useCallsignSearch";
import { useColors } from "@/hooks/useColors";
import { useSpotData } from "@/hooks/useSpotData";
import { useSpotInteraction } from "@/hooks/useSpotInteraction";
import { useTimeZone } from "@/hooks/useTimeZone";
import { useLocalStorage } from "@uidotdev/usehooks";
import { useState } from "react";

const CALLSIGN_PATTERN = /^[A-Z0-9][A-Z0-9/]{0,31}$/;
const DAY_MS = 86_400_000;
const CUSTOM = "custom";
const NOW = "now";
const DEFAULT_FROM_PRESET = FROM_PRESETS[0].value;

// Date and time inputs have no zone, so the selected zone decides how their
// values map to an instant.
function split_date(date, is_utc) {
    const shifted = is_utc ? date : new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    const [day, time] = shifted.toISOString().slice(0, 16).split("T");
    return { date: day, time };
}

function join_date(day, time, is_utc) {
    if (!day || !time) return null;
    const value = `${day}T${time}`;
    const date = new Date(is_utc ? `${value}Z` : value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function resolve_range(form, is_utc, now) {
    const end = form.to_preset === NOW ? now : join_date(form.to_date, form.to_time, is_utc);
    if (form.from_preset === CUSTOM) {
        return { start: join_date(form.from_date, form.from_time, is_utc), end };
    }
    const preset = FROM_PRESETS.find(p => p.value === form.from_preset);
    return { start: end && new Date(end.getTime() - preset.ms), end };
}

// The last applied time range, minus the callsign. Stored as epoch ms so it
// doesn't depend on the time zone it was entered in.
const SAVED_RANGE_KEY = "callsign_search_range";

// localStorage can hold anything, so only trust values we recognize
function read_saved_range(saved) {
    const from_presets = [...FROM_PRESETS.map(p => p.value), CUSTOM];
    const is_time = value => Number.isFinite(value) && !Number.isNaN(new Date(value).getTime());
    return {
        from_preset: from_presets.includes(saved?.from_preset)
            ? saved.from_preset
            : DEFAULT_FROM_PRESET,
        to_preset: [NOW, CUSTOM].includes(saved?.to_preset) ? saved.to_preset : NOW,
        start_ms: is_time(saved?.start_ms) ? saved.start_ms : null,
        end_ms: is_time(saved?.end_ms) ? saved.end_ms : null,
    };
}

function validate({ callsign, start, end }) {
    if (!callsign) return "Enter a DX callsign";
    if (!CALLSIGN_PATTERN.test(callsign)) return "Invalid callsign";
    if (start == null || end == null) return "Enter a start and end time";
    if (end <= start) return "End must be after start";
    if (end - start > MAX_SEARCH_RANGE_MS) return "Range cannot exceed 14 days";
    return null;
}

function TimeRangeField({ label, select_value, options, on_select, date, time, on_change }) {
    return (
        <div className="flex flex-col gap-1">
            <span>{label}</span>
            <Select className="w-full" value={select_value} onChange={on_select}>
                {options.map(option => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
                <option value={CUSTOM}>Custom</option>
            </Select>
            {select_value === CUSTOM && (
                <div className="flex gap-2">
                    <Input
                        className="w-full"
                        type="date"
                        aria-label={`${label} date`}
                        value={date}
                        onChange={e => on_change({ date: e.target.value })}
                    />
                    <Input
                        className="w-full"
                        type="time"
                        aria-label={`${label} time`}
                        value={time}
                        onChange={e => on_change({ time: e.target.value })}
                    />
                </div>
            )}
        </div>
    );
}

// `dx` prefills the callsign, e.g. from a spot's "View History"; `external_open`
// opens the modal without its button (see Modal).
export default function CallsignSearchModal({
    button,
    dx = null,
    external_open = null,
    data_tour = null,
    trigger_class_name = "",
}) {
    const { colors } = useColors();
    const { callsign_search, set_callsign_search } = useSpotData();
    const { search_query } = useSpotInteraction();
    const { time_zone, label } = useTimeZone();
    const is_utc = time_zone === "utc";
    const [saved_range, set_saved_range] = useLocalStorage(SAVED_RANGE_KEY, null);
    const [form, set_form] = useState({
        callsign: "",
        from_preset: DEFAULT_FROM_PRESET,
        from_date: "",
        from_time: "",
        to_preset: NOW,
        to_date: "",
        to_time: "",
    });

    // Restores the last time range used, even after the search was exited.
    // The callsign isn't remembered: it's `dx` if given, else the active
    // search's, else whatever is typed in the table's search box.
    function reset_form() {
        const saved = read_saved_range(saved_range);
        const end = saved.end_ms != null ? new Date(saved.end_ms) : new Date();
        const start =
            saved.start_ms != null ? new Date(saved.start_ms) : new Date(end.getTime() - DAY_MS);
        const from = split_date(start, is_utc);
        const to = split_date(end, is_utc);
        set_form({
            callsign: dx ?? callsign_search?.callsign ?? normalize_search_callsign(search_query),
            from_preset: saved.from_preset,
            from_date: from.date,
            from_time: from.time,
            to_preset: saved.to_preset,
            to_date: to.date,
            to_time: to.time,
        });
    }

    // Switching to Custom starts from the range currently selected, so the
    // inputs are never blank or inverted.
    function select_preset(field, value) {
        const next = { ...form, [`${field}_preset`]: value };
        if (value === CUSTOM) {
            const range = resolve_range(form, is_utc, new Date());
            const date = field === "from" ? range.start : range.end;
            if (date) {
                const parts = split_date(date, is_utc);
                next[`${field}_date`] = parts.date;
                next[`${field}_time`] = parts.time;
            }
        }
        set_form(next);
    }

    const range = resolve_range(form, is_utc, new Date());
    const error = validate({ callsign: form.callsign, ...range });

    return (
        <Modal
            title={
                <h3 className="text-2xl" style={{ color: colors.theme.text }}>
                    Search DX History
                </h3>
            }
            button={button}
            external_open={external_open}
            data_tour={data_tour}
            trigger_class_name={trigger_class_name}
            on_open={reset_form}
            on_cancel={() => {}}
            on_apply={() => {
                // Re-resolve so "Now" is the moment Search was clicked
                const { start, end } = resolve_range(form, is_utc, new Date());
                if (validate({ callsign: form.callsign, start, end })) return false;
                set_saved_range({
                    from_preset: form.from_preset,
                    to_preset: form.to_preset,
                    start_ms: start.getTime(),
                    end_ms: end.getTime(),
                });
                set_callsign_search({
                    callsign: form.callsign,
                    start,
                    end,
                    from_preset: form.from_preset,
                    to_preset: form.to_preset,
                });
                return true;
            }}
            apply_text="Search"
            apply_disabled={error != null}
        >
            <div className="flex flex-col gap-3 p-4">
                <label className="flex flex-col gap-1">
                    <span>DX callsign</span>
                    <Input
                        className="w-full"
                        data-autofocus
                        value={form.callsign}
                        onChange={e =>
                            set_form({
                                ...form,
                                callsign: normalize_search_callsign(e.target.value),
                            })
                        }
                    />
                </label>
                <TimeRangeField
                    label={form.from_preset === CUSTOM ? `From (${label})` : "From"}
                    select_value={form.from_preset}
                    options={FROM_PRESETS}
                    on_select={e => select_preset("from", e.target.value)}
                    date={form.from_date}
                    time={form.from_time}
                    on_change={({ date = form.from_date, time = form.from_time }) =>
                        set_form({ ...form, from_date: date, from_time: time })
                    }
                />
                <TimeRangeField
                    label={form.to_preset === CUSTOM ? `To (${label})` : "To"}
                    select_value={form.to_preset}
                    options={[{ value: NOW, label: "Now" }]}
                    on_select={e => select_preset("to", e.target.value)}
                    date={form.to_date}
                    time={form.to_time}
                    on_change={({ date = form.to_date, time = form.to_time }) =>
                        set_form({ ...form, to_date: date, to_time: time })
                    }
                />
                <p className="text-sm" style={{ color: error ? "#ef4444" : colors.theme.text }}>
                    {error ?? "Up to 14 days. Your current filters are applied to the results."}
                </p>
            </div>
        </Modal>
    );
}

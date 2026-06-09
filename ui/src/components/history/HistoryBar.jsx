import HistoryBarSettings from "@/components/history/HistoryBarSettings.jsx";
import Button from "@/components/ui/Button.jsx";
import Select from "@/components/ui/Select.jsx";
import { useColors } from "@/hooks/useColors";
import { useProfiles } from "@/hooks/useProfiles.jsx";
import { useCallback, useEffect, useRef, useState } from "react";

const PRESETS = [
    { label: "8h", hours: 8 },
    { label: "12h", hours: 12 },
    { label: "24h", hours: 24 },
    { label: "48h", hours: 48 },
    { label: "72h", hours: 72 },
];

const MIN_WINDOW_MS = 15 * 60_000; // m * ms/m = ms
const MAX_WINDOW_MS = 8 * 60 * 60_000; // H * m/H * ms/m = ms

function fmt_utc_hhmm(date) {
    const h = String(date.getUTCHours()).padStart(2, "0");
    const m = String(date.getUTCMinutes()).padStart(2, "0");
    return `${h}:${m}`;
}

function fmt_utc_date(date) {
    return date.toUTCString().slice(5, 11);
}

function tick_interval_hours(range_hours) {
    if (range_hours <= 8) return 1;
    if (range_hours <= 12) return 2;
    if (range_hours <= 24) return 4;
    if (range_hours <= 48) return 8;
    return 12;
}

function HistoryBar({ start, end, set_start, set_end, window_size_ms, set_window_size_ms }) {
    const { colors } = useColors();
    const {
        active_profile_data: {
            history: { display_hours, time_between_shifts },
        },
        update_active_profile_section,
    } = useProfiles();

    const [is_playing, set_is_playing] = useState(false);

    function set_display_hours(value) {
        update_active_profile_section("history", history => ({
            ...history,
            display_hours: value,
        }));
    }

    function set_time_between_shifts(value) {
        update_active_profile_section("history", history => ({
            ...history,
            time_between_shifts: value,
        }));
    }

    const bar_ref = useRef(null);
    const drag_ref = useRef(null);
    const interval_ref = useRef(null);

    // Bar always ends at now on the right
    const now_ms = Date.now();
    const display_ms = display_hours * 3_600_000;
    const bar_start_ms = now_ms - display_ms;
    const bar_end_ms = now_ms;

    const window_ms = window_size_ms || end.getTime() - start.getTime();

    // Position of the window within the bar (0–1)
    const win_left = Math.max(0, Math.min(1, (start.getTime() - bar_start_ms) / display_ms));
    const win_width = Math.max(0, Math.min(1 - win_left, window_ms / display_ms));

    // Tick marks
    const interval_ms = tick_interval_hours(display_hours) * 3_600_000;
    const first_tick = Math.ceil(bar_start_ms / interval_ms) * interval_ms;
    const multi_day = display_hours > 24;
    const ticks = [];
    for (let t = first_tick; t < bar_end_ms; t += interval_ms) {
        const frac = (t - bar_start_ms) / display_ms;
        const date = new Date(t);
        const is_midnight = date.getUTCHours() === 0;
        ticks.push({ ms: t, frac, date, is_midnight });
    }

    // --- Preset: change display range, clamp window to new bar ---
    function apply_preset(hours) {
        const new_now = Date.now();
        const new_bar_start = new_now - hours * 3_600_000;
        let s = start.getTime();
        let e = end.getTime();
        const win = e - s;
        if (s < new_bar_start) {
            s = new_bar_start;
            e = s + win;
        }
        if (e > new_now) {
            e = new_now;
            s = Math.max(new_bar_start, e - win);
        }
        set_display_hours(hours);
        set_start(new Date(s));
        set_end(new Date(e));
    }

    // --- Step / play ---
    function shift(direction) {
        const delta_ms = window_ms * direction;
        let new_start = start.getTime() + delta_ms;
        let new_end = end.getTime() + delta_ms;
        if (new_start < bar_start_ms) {
            new_start = bar_start_ms;
            new_end = new_start + window_ms;
        }
        if (new_end > bar_end_ms) {
            new_end = bar_end_ms;
            new_start = new_end - window_ms;
        }
        set_start(new Date(new_start));
        set_end(new Date(new_end));
    }

    function step_forward() {
        shift(1);
    }
    function step_back() {
        shift(-1);
    }

    useEffect(() => {
        if (is_playing) {
            interval_ref.current = setInterval(step_forward, time_between_shifts * 1000);
        } else {
            clearInterval(interval_ref.current);
        }
        return () => clearInterval(interval_ref.current);
    }, [is_playing, window_ms, time_between_shifts, start, end]);

    // --- Drag ---
    const on_bar_mouse_down = useCallback(
        e => {
            if (!bar_ref.current) return;
            e.preventDefault();
            const rect = bar_ref.current.getBoundingClientRect();
            const frac = (e.clientX - rect.left) / rect.width;
            const clicked_ms = bar_start_ms + frac * display_ms;
            const raw_start = clicked_ms - window_ms / 2;
            const new_start = Math.max(bar_start_ms, Math.min(bar_end_ms - window_ms, raw_start));
            const new_end = new_start + window_ms;
            set_start(new Date(new_start));
            set_end(new Date(new_end));
            set_is_playing(false);
            drag_ref.current = {
                type: "move",
                start_x: e.clientX,
                orig_start_ms: new_start,
                orig_end_ms: new_end,
            };
        },
        [bar_start_ms, display_ms, window_ms, bar_end_ms],
    );

    const on_window_mouse_down = useCallback(
        e => {
            e.stopPropagation();
            e.preventDefault();
            set_is_playing(false);
            drag_ref.current = {
                type: "move",
                start_x: e.clientX,
                orig_start_ms: start.getTime(),
                orig_end_ms: end.getTime(),
            };
        },
        [start, end],
    );

    const on_resize_mouse_down = useCallback(
        e => {
            e.stopPropagation();
            e.preventDefault();
            set_is_playing(false);
            drag_ref.current = {
                type: "resize",
                start_x: e.clientX,
                orig_start_ms: start.getTime(),
                orig_end_ms: end.getTime(),
            };
        },
        [start, end],
    );

    useEffect(() => {
        function on_mouse_move(e) {
            if (!drag_ref.current || !bar_ref.current) return;
            const rect = bar_ref.current.getBoundingClientRect();
            const dx_ms = ((e.clientX - drag_ref.current.start_x) / rect.width) * display_ms;

            if (drag_ref.current.type === "move") {
                let s = drag_ref.current.orig_start_ms + dx_ms;
                let en = drag_ref.current.orig_end_ms + dx_ms;
                if (s < bar_start_ms) {
                    en += bar_start_ms - s;
                    s = bar_start_ms;
                }
                if (en > bar_end_ms) {
                    s -= en - bar_end_ms;
                    en = bar_end_ms;
                }
                set_start(new Date(s));
                set_end(new Date(en));
            } else {
                let new_end_ms = drag_ref.current.orig_end_ms + dx_ms;
                const new_win = Math.max(
                    MIN_WINDOW_MS,
                    Math.min(MAX_WINDOW_MS, new_end_ms - drag_ref.current.orig_start_ms),
                );
                new_end_ms = drag_ref.current.orig_start_ms + new_win;
                set_end(new Date(Math.min(new_end_ms, bar_end_ms)));
                set_window_size_ms(new_win);
            }
        }

        function on_mouse_up() {
            drag_ref.current = null;
        }

        window.addEventListener("mousemove", on_mouse_move);
        window.addEventListener("mouseup", on_mouse_up);
        return () => {
            window.removeEventListener("mousemove", on_mouse_move);
            window.removeEventListener("mouseup", on_mouse_up);
        };
    }, [bar_start_ms, display_ms, bar_end_ms, set_start, set_end, set_window_size_ms]);

    const btn_style = {
        background: colors.theme.background,
        border: `1px solid ${colors.theme.text}55`,
        color: colors.theme.text,
    };
    return (
        <div
            className="flex flex-row px-3 py-1 gap-1 select-none"
            style={{
                background: colors.theme.background,
                borderTop: `1px solid ${colors.theme.borders}`,
                color: colors.theme.text,
            }}
        >
            {/* Controls row */}
            <div className="flex flex-row items-center gap-2 text-xs">
                <div
                    className="w-px self-stretch mx-1"
                    style={{ background: `${colors.theme.text}30` }}
                />

                {/* Step / play controls */}
                <Button
                    onClick={step_back}
                    className="h-full aspect-square rounded"
                    style={btn_style}
                    title="Step back one window"
                >
                    ◀◀
                </Button>
                <Button
                    onClick={() => set_is_playing(p => !p)}
                    className="h-full aspect-square rounded"
                    style={btn_style}
                    title={is_playing ? "Pause" : "Play forward"}
                >
                    {is_playing ? "⏸" : "▶"}
                </Button>
                <Button
                    onClick={step_forward}
                    className="h-full aspect-square rounded"
                    style={btn_style}
                    title="Step forward one window"
                >
                    ▶▶
                </Button>
            </div>

            {/* Timeline bar — right edge = now */}
            <div className="relative w-full h-full">
                {/* Track */}
                <div
                    ref={bar_ref}
                    className="absolute inset-0 rounded cursor-crosshair"
                    style={{ background: colors.theme.columns }}
                    onMouseDown={on_bar_mouse_down}
                />

                {/* Selected window */}
                <div
                    className="absolute top-0 bottom-0 rounded cursor-grab active:cursor-grabbing"
                    style={{
                        left: `${win_left * 100}%`,
                        width: `${win_width * 100}%`,
                        background: "#3b82f6",
                        opacity: 0.65,
                        minWidth: "4px",
                    }}
                    onMouseDown={on_window_mouse_down}
                >
                    <div
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 flex items-center justify-center"
                        onMouseDown={on_resize_mouse_down}
                        title="Drag to resize window"
                    >
                        <div className="w-0.5 h-3 rounded bg-white opacity-80" />
                    </div>
                </div>

                {/* Tick marks */}
                {ticks.map(tick => {
                    const is_last = tick.frac > 0.95;
                    return (
                        <div
                            key={tick.ms}
                            className="absolute top-0 bottom-0 flex flex-col items-center pointer-events-none"
                            style={{
                                left: `${tick.frac * 100}%`,
                                transform: is_last
                                    ? "translateX(-100%)"
                                    : tick.frac < 0.05
                                      ? "none"
                                      : "translateX(-50%)",
                            }}
                        >
                            <div
                                className="w-px opacity-75"
                                style={{
                                    height: tick.is_midnight && multi_day ? "100%" : "12px",
                                    background: colors.theme.text,
                                }}
                            />
                            {tick.is_midnight && multi_day ? (
                                <span
                                    className="text-[12px] leading-none mt-0.5 whitespace-nowrap font-medium"
                                    style={{
                                        color: colors.theme.text,
                                        opacity: 1,
                                    }}
                                >
                                    {fmt_utc_date(tick.date)}
                                </span>
                            ) : (
                                <span
                                    className="text-[12px] leading-none mt-0.5 whitespace-nowrap"
                                    style={{
                                        color: colors.theme.text,
                                        opacity: 0.8,
                                    }}
                                >
                                    {fmt_utc_hhmm(tick.date)}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
            {/* Preset display-range buttons */}
            <Select
                className="w-min"
                value={display_hours}
                onChange={e => apply_preset(Number(e.target.value))}
            >
                {PRESETS.map(p => (
                    <option key={p.hours} value={p.hours}>
                        {p.label}
                    </option>
                ))}
            </Select>

            {/* Settings button */}
            <HistoryBarSettings
                window_ms={window_ms}
                set_window_size_ms={set_window_size_ms}
                start={start}
                set_end={set_end}
                time_between_shifts={time_between_shifts}
                set_time_between_shifts={set_time_between_shifts}
            />
        </div>
    );
}

export default HistoryBar;

import { useState, useEffect, useRef } from "react";
import { useColors } from "@/hooks/useColors";
import Button from "@/components/ui/Button.jsx";
import Popup from "@/components/ui/Popup.jsx";
import Input from "@/components/ui/Input";
import { SettingsIcon } from "@/components/settings/Settings";

const MAX_WINDOW_MS = 8 * 60 * 60_000;

function HistoryBarSettings({
    window_ms,
    set_window_size_ms,
    start,
    set_end,
    time_between_shifts,
    set_time_between_shifts,
}) {
    const { colors } = useColors();
    const [show_settings, set_show_settings] = useState(false);
    const [window_input, set_window_input] = useState("");
    const [speed_input, set_speed_input] = useState("");

    const settings_btn_ref = useRef(null);
    const settings_popup_ref = useRef(null);

    const window_min = Math.round(window_ms / 60_000);

    useEffect(() => {
        if (show_settings) {
            set_window_input(String(window_min));
        }
    }, [window_ms]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!show_settings) return;
        set_window_input(String(window_min));
        set_speed_input(String(time_between_shifts));
        function handle_click(e) {
            if (
                settings_btn_ref.current?.contains(e.target) ||
                settings_popup_ref.current?.contains(e.target)
            )
                return;
            set_show_settings(false);
        }
        document.addEventListener("mousedown", handle_click);
        return () => document.removeEventListener("mousedown", handle_click);
    }, [show_settings]); // eslint-disable-line react-hooks/exhaustive-deps

    function apply_window_input() {
        const v = parseInt(window_input);
        if (!isNaN(v) && v >= 1) {
            const new_ms = Math.min(v * 60_000, MAX_WINDOW_MS);
            set_window_size_ms(new_ms);
            set_end(new Date(start.getTime() + new_ms));
            set_window_input(String(Math.round(new_ms / 60_000)));
        } else {
            set_window_input(String(window_min));
        }
    }

    function apply_speed_input() {
        const v = parseInt(speed_input);
        if (!isNaN(v) && v >= 1 && v <= 60) {
            set_time_between_shifts(v);
        } else {
            set_speed_input(String(time_between_shifts));
        }
    }

    const btn_style = {
        background: colors.theme.background,
        border: `1px solid ${colors.theme.text}55`,
        color: colors.theme.text,
    };

    return (
        <div ref={settings_btn_ref} className="relative flex items-center gap-x-2">
            <Button
                onClick={() => set_show_settings(v => !v)}
                className="h-full aspect-square rounded"
                style={{
                    ...btn_style,
                    background: show_settings ? "#3b82f6" : btn_style.background,
                    border: show_settings ? "1px solid #3b82f6" : btn_style.border,
                    color: show_settings ? "white" : btn_style.color,
                }}
                title="Playback settings"
            >
                <SettingsIcon />
            </Button>

            {show_settings && (
                <Popup anchor_ref={settings_btn_ref} vertical_offset={-4} keep_in_view={true}>
                    <div
                        ref={settings_popup_ref}
                        className="pointer-events-auto rounded-lg shadow-xl px-4 py-3 flex flex-col gap-3 text-sm"
                        style={{
                            background: colors.theme.background,
                            border: `1px solid ${colors.theme.borders}`,
                            color: colors.theme.text,
                            minWidth: "210px",
                        }}
                    >
                        <label className="flex items-center justify-between gap-3">
                            <span>Window size (min)</span>
                            <Input
                                type="text"
                                value={window_input}
                                onChange={e => set_window_input(e.target.value)}
                                onBlur={apply_window_input}
                                onKeyDown={e => {
                                    if (e.key === "Enter") {
                                        apply_window_input();
                                        e.target.blur();
                                    }
                                    if (e.key === "Escape") {
                                        set_window_input(String(window_min));
                                        e.target.blur();
                                    }
                                }}
                                className="w-16 text-right"
                            />
                        </label>
                        <div className="flex items-center justify-between gap-3">
                            <span>Playback speed (s)</span>
                            <div className="flex items-center gap-1">
                                <div
                                    className="flex items-stretch rounded-lg overflow-hidden"
                                    style={{ backgroundColor: colors.theme.input_background }}
                                >
                                    <Input
                                        type="text"
                                        value={speed_input}
                                        onChange={e => set_speed_input(e.target.value)}
                                        onBlur={apply_speed_input}
                                        onKeyDown={e => {
                                            if (e.key === "Enter") {
                                                apply_speed_input();
                                                e.target.blur();
                                            }
                                            if (e.key === "Escape") {
                                                set_speed_input(String(time_between_shifts));
                                                e.target.blur();
                                            }
                                        }}
                                        className="w-10 py-2 pl-3 pr-1 leading-tight text-center outline-none"
                                        style={{
                                            backgroundColor: "transparent",
                                            color: colors.theme.text,
                                        }}
                                    />
                                    <div
                                        className="flex flex-col"
                                        style={{ borderLeft: `1px solid ${colors.theme.text}33` }}
                                    >
                                        <button
                                            className="flex-1 flex items-center justify-center px-1.5 hover:bg-white/10 active:bg-white/20"
                                            style={{
                                                color: colors.theme.text,
                                                fontSize: "9px",
                                                borderBottom: `1px solid ${colors.theme.text}33`,
                                            }}
                                            onClick={() => {
                                                const next = Math.min(60, time_between_shifts + 1);
                                                set_time_between_shifts(next);
                                                set_speed_input(String(next));
                                            }}
                                        >
                                            ▲
                                        </button>
                                        <button
                                            className="flex-1 flex items-center justify-center px-1.5 hover:bg-white/10 active:bg-white/20"
                                            style={{ color: colors.theme.text, fontSize: "9px" }}
                                            onClick={() => {
                                                const next = Math.max(1, time_between_shifts - 1);
                                                set_time_between_shifts(next);
                                                set_speed_input(String(next));
                                            }}
                                        >
                                            ▼
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </Popup>
            )}
        </div>
    );
}

export default HistoryBarSettings;

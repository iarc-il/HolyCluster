import React, { useState, useRef, useEffect } from "react";
import { use_object_local_storage } from "@/utils.js";
import { useReplay } from "@/hooks/useReplay";
import { useColors } from "@/hooks/useColors";
import Select from "@/components/ui/Select.jsx";

const hour_options = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 18, 20, 24, 30, 36, 48, 72, 96, 120, 168];

const window_options = {
    "5 min": 300,
    "15 min": 900,
    "30 min": 1800,
    "1 hour": 3600,
};

const step_options = {
    "1 min": 60,
    "5 min": 300,
    "15 min": 900,
    "30 min": 1800,
};

const speed_options = {
    "0.5 s": 0.5,
    "1 s": 1,
    "2 s": 2,
    "5 s": 5,
};

function GearIcon({ size = 20, color = "currentColor" }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
            <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z" />
        </svg>
    );
}

function ControlButton({ onClick, title, children, color }) {
    const { colors } = useColors();
    return (
        <button
            onClick={onClick}
            title={title}
            className="flex items-center justify-center w-9 h-9 rounded-lg hover:opacity-80 active:opacity-60 transition-opacity select-none text-base"
            style={{
                backgroundColor: color || colors.theme.input_background,
                color: "white",
            }}
        >
            {children}
        </button>
    );
}

function SettingsPanel({ config, setConfig, on_close }) {
    const { colors } = useColors();
    const text = { color: colors.theme.text };

    return (
        <div
            className="flex flex-col gap-2 p-3 border-b shrink-0"
            style={{ borderColor: colors.theme.borders, position: 'relative', zIndex: 20, marginTop: '52px' }}
        >
            <div className="flex justify-between items-center">
                <span className="font-semibold text-lg" style={text}>Settings</span>
                <button onClick={on_close} className="text-2xl font-bold leading-none hover:opacity-60" style={{ color: "white", marginRight: '4px' }}>✕</button>
            </div>

            <div className="flex gap-2 items-center">
                <label className="text-lg w-20 shrink-0" style={text}>Window</label>
                <Select value={config.window_duration} onChange={e => setConfig(c => ({ ...c, window_duration: Number(e.target.value) }))} className="w-24">
                    {Object.entries(window_options).map(([label, val]) => (
                        <option key={val} value={val}>{label}</option>
                    ))}
                </Select>
            </div>

            <div className="flex gap-2 items-center">
                <label className="text-lg w-20 shrink-0" style={text}>Step</label>
                <Select value={config.step_size} onChange={e => setConfig(c => ({ ...c, step_size: Number(e.target.value) }))} className="w-24">
                    {Object.entries(step_options).map(([label, val]) => (
                        <option key={val} value={val}>{label}</option>
                    ))}
                </Select>
            </div>

            <div className="flex gap-2 items-center">
                <label className="text-lg w-20 shrink-0" style={text}>Speed</label>
                <Select value={config.playback_speed} onChange={e => setConfig(c => ({ ...c, playback_speed: Number(e.target.value) }))} className="w-24">
                    {Object.entries(speed_options).map(([label, val]) => (
                        <option key={val} value={val}>{label}</option>
                    ))}
                </Select>
            </div>
        </div>
    );
}

function HoursRow({ label, value, onChange, colors, min, max }) {
    // Filter options based on min/max if provided
    const filtered_options = hour_options.filter(h => (min === undefined || h >= min) && (max === undefined || h <= max));
    return (
        <div
            className="flex flex-col items-start py-1 shrink-0"
            style={{ paddingLeft: '12px', borderColor: colors.theme.borders }}
        >
            <span
                className="font-bold"
                style={{ color: colors.theme.text, fontSize: "1.25rem", marginBottom: "0.15em" }}
            >
                {label}
            </span>
            <select
                value={value}
                onChange={e => onChange(Number(e.target.value))}
                style={{
                    width: "120px",
                    backgroundColor: colors.theme.input_background,
                    color: colors.theme.text,
                    borderRadius: "0.5rem",
                    padding: "0.25rem 0.5rem",
                    fontSize: "1.125rem",
                    fontWeight: "600",
                }}
            >
                {filtered_options.map(h => (
                    <option key={h} value={h}>{h}h ago</option>
                ))}
            </select>
        </div>
    );
}

export default function ReplayControls() {
    const { colors } = useColors();
    const {
        is_replay_active,
        replay_spots,
        replay_config,
        current_frame_start,
        is_playing,
        is_loading,
        error,
        load_replay,
        exit_replay,
        play,
        pause,
        step_forward,
        step_backward,
        seek,
    } = useReplay();

    const [settings_open, set_settings_open] = useState(false);
    const [is_dragging, set_is_dragging] = useState(false);
    const paused_for_hover_ref = useRef(false);
    const axis_container_ref = useRef(null);
    const drag_data_ref = useRef(null);
    const [config, set_config] = use_object_local_storage("playback_config", {
        from_hours: 20,
        until_hours: 7,
        window_duration: 900,
        step_size: 300,
        playback_speed: 1,
    });

    async function handle_load() {
        const now = Math.floor(Date.now() / 1000);
        const start_time = now - config.from_hours * 3600;
        const end_time = now - config.until_hours * 3600;
        if (end_time <= start_time) return;
        if (config.window_duration > end_time - start_time) return;
        const cfg = {
            start_time,
            end_time,
            window_duration: config.window_duration,
            step_size: config.step_size,
            playback_speed: config.playback_speed,
        };
        await load_replay(cfg);
        play(cfg, start_time);
    }

    async function handle_play_pause() {
        if (is_playing) {
            pause();
        } else if (!is_replay_active) {
            await handle_load();
        } else {
            play(replay_config, current_frame_start);
        }
    }

    function go_to_start() { pause(); seek(replay_config.start_time); }
    function go_to_end()   { pause(); seek(replay_config.end_time - replay_config.window_duration); }

    // Axis calculations
    const MARGIN = 2;
    const AXIS_RANGE = 100 - MARGIN * 2;
    const AXIS_RIGHT = 55; // px from right — axis sits more toward the left

    let segment_bottom_pct = MARGIN;
    let segment_height_pct = AXIS_RANGE;
    let arrow_pct = 50;

    if (replay_config && current_frame_start !== null) {
        const total = replay_config.end_time - replay_config.start_time;
        const raw_bottom = (current_frame_start - replay_config.start_time) / total;
        const raw_top = (current_frame_start + replay_config.window_duration - replay_config.start_time) / total;
        segment_bottom_pct = MARGIN + raw_bottom * AXIS_RANGE;
        segment_height_pct = (raw_top - raw_bottom) * AXIS_RANGE;
        arrow_pct = MARGIN + ((raw_bottom + raw_top) / 2) * AXIS_RANGE;
    }

    // Hour tick marks
    const now = Math.floor(Date.now() / 1000);
    const axis_start = replay_config ? replay_config.start_time : now - config.from_hours * 3600;
    const axis_end   = replay_config ? replay_config.end_time   : now - config.until_hours * 3600;
    const axis_total = axis_end - axis_start;
    let ticks = [];
    if (axis_total > 0) {
        // Always include the start and end of the axis
        ticks.push(MARGIN); // Top
        const total_hours = (axis_end - axis_start) / 3600;
        // Place ticks evenly between start and end (excluding the ends)
        for (let h = 1; h < total_hours; h++) {
            const pct = MARGIN + (h / total_hours) * AXIS_RANGE;
            ticks.push(pct);
        }
        ticks.push(MARGIN + AXIS_RANGE); // Bottom
    }

    const from_h  = replay_config ? Math.round((now - replay_config.start_time) / 3600) : config.from_hours;
    const until_h = replay_config ? Math.round((now - replay_config.end_time)   / 3600) : config.until_hours;

    // Update drag ref with latest values — merge to preserve drag_start_y/drag_start_frame set on mousedown
    drag_data_ref.current = { ...drag_data_ref.current, axis_total, replay_config };

    // Drag effect — attach/detach global mouse listeners
    useEffect(() => {
        if (!is_dragging) return;
        function on_move(e) {
            const { axis_total, replay_config, drag_start_y, drag_start_frame } = drag_data_ref.current;
            if (!axis_container_ref.current || !replay_config) return;
            const rect = axis_container_ref.current.getBoundingClientRect();
            const axis_height_px = rect.height * AXIS_RANGE / 100;
            const time_per_px = axis_total / axis_height_px;
            // Moving mouse up = towards more recent time = increasing frame_start
            const dy = drag_start_y - e.clientY;
            const new_frame = drag_start_frame + dy * time_per_px;
            const clamped = Math.max(
                replay_config.start_time,
                Math.min(new_frame, replay_config.end_time - replay_config.window_duration),
            );
            seek(clamped);
        }
        function on_up() { set_is_dragging(false); }
        document.addEventListener("mousemove", on_move);
        document.addEventListener("mouseup", on_up);
        return () => {
            document.removeEventListener("mousemove", on_move);
            document.removeEventListener("mouseup", on_up);
        };
    }, [is_dragging, seek]);

    function handle_arrow_mouse_down(e) {
        if (!is_replay_active || !replay_config) return;
        e.preventDefault();
        paused_for_hover_ref.current = false;
        pause();
        // Store drag start position and current frame so motion is relative
        drag_data_ref.current = {
            ...drag_data_ref.current,
            drag_start_y: e.clientY,
            drag_start_frame: current_frame_start,
        };
        set_is_dragging(true);
    }

    const axis_color    = "#22c55e";
    const segment_color = "#22c55e";
    const arrow_color   = colors.theme.text;

    // Handlers to enforce until_hours <= from_hours
    function handleUntilChange(v) {
        set_config(c => {
            const until = v;
            const from = Math.max(c.from_hours, until);
            return { ...c, until_hours: until, from_hours: from };
        });
    }

    function handleFromChange(v) {
        set_config(c => {
            const from = v;
            const until = Math.min(c.until_hours, from);
            return { ...c, from_hours: from, until_hours: until };
        });
    }

    return (
        <div className="flex flex-col h-full relative" style={{ minHeight: "300px", marginLeft: "-8px" }}>

            {/* Gear icon — floating top-right, hidden during playback */}
            {!is_replay_active && (
                <div className="absolute" style={{ top: '18px', right: '10px', zIndex: 20 }}>
                    <button onClick={() => set_settings_open(o => !o)} title="Settings"
                        className="hover:opacity-70 transition-opacity"
                        style={{ color: settings_open ? "#22c55e" : colors.theme.text }}>
                        <GearIcon size={32} color="currentColor" />
                    </button>
                </div>
            )}

            {/* Exit button — top-right, shown during playback in place of gear */}
            {is_replay_active && (
                <div className="absolute" style={{ top: '18px', right: '10px', zIndex: 20 }}>
                    <ControlButton onClick={exit_replay} title="Exit playback" color="#ef4444">✕</ControlButton>
                </div>
            )}

            {/* Settings panel */}
            {settings_open && !is_replay_active && (
                <SettingsPanel
                    config={config}
                    setConfig={set_config}
                    on_close={() => set_settings_open(false)}
                />
            )}

            {/* Time axis area */}
            <div ref={axis_container_ref} className="flex-1 relative overflow-hidden" style={{ minHeight: "100px", cursor: is_dragging ? "grabbing" : "default" }}>

                {/* UNTIL — pinned to top */}
                {!is_replay_active && (
                    <div className="absolute left-0 right-0" style={{ top: '8px' }}>
                        <HoursRow
                            label="Until"
                            value={until_h}
                            onChange={handleUntilChange}
                            colors={colors}
                            max={from_h}
                        />
                    </div>
                )}



                {/* Axis track */}
                <div className="absolute" style={{
                    right: `${AXIS_RIGHT}px`,
                    top: `${MARGIN}%`,
                    bottom: `${MARGIN}%`,
                    width: "4px",
                    backgroundColor: axis_color,
                    borderRadius: "2px",
                    opacity: 1,
                }} />

                {/* Top white tick (longer) */}
                <div className="absolute" style={{
                    right: `${AXIS_RIGHT + 1}px`,
                    top: `${MARGIN}%`,
                    width: "18px",
                    height: "2.5px",
                    backgroundColor: "#fff",
                    opacity: 1,
                    borderRadius: "2px",
                    transform: "translateY(-50%)"
                }} />

                {/* Bottom white tick (longer) */}
                <div className="absolute" style={{
                    right: `${AXIS_RIGHT + 1}px`,
                    bottom: `${MARGIN}%`,
                    width: "18px",
                    height: "2.5px",
                    backgroundColor: "#fff",
                    opacity: 1,
                    borderRadius: "2px",
                    transform: "translateY(50%)"
                }} />

                {/* Half-hour ticks */}
                {axis_total > 0 && (() => {
                    const total_hours = axis_total / 3600;
                    const half_ticks = [];
                    for (let h = 0.5; h < total_hours; h += 1) {
                        half_ticks.push(MARGIN + (h / total_hours) * AXIS_RANGE);
                    }
                    return half_ticks.map((pct, i) => (
                        <div key={`half_${i}`} className="absolute" style={{
                            right: `${AXIS_RIGHT + 4}px`,
                            bottom: `${pct}%`,
                            width: "10px",
                            height: "2px",
                            backgroundColor: "#fff",
                            opacity: 1,
                            borderRadius: "2px",
                            transform: "translateY(50%)",
                        }} />
                    ));
                })()}

                {/* Hour ticks + labels */}
                {ticks.map((pct, i) => {
                    const hour_label = from_h - i;
                    return (
                        <React.Fragment key={i}>
                            <div className="absolute" style={{
                                right: `${AXIS_RIGHT + 4}px`,
                                bottom: `${pct}%`,
                                width: i === 0 || i === ticks.length - 1 ? "18px" : "16px",
                                height: "2.5px",
                                backgroundColor: "#fff",
                                opacity: 1,
                                borderRadius: "2px",
                                transform: "translateY(50%)",
                            }} />
                            <div className="absolute" style={{
                                right: `${AXIS_RIGHT + 26}px`,
                                bottom: `${pct}%`,
                                transform: "translateY(50%)",
                                color: "#fff",
                                fontSize: "1rem",
                                fontWeight: 600,
                                whiteSpace: "nowrap",
                                opacity: 0.85,
                            }}>
                                -{hour_label}h
                            </div>
                        </React.Fragment>
                    );
                })}

                {/* Highlighted window segment */}
                {is_replay_active && (
                    <div className="absolute" style={{
                        right: `${AXIS_RIGHT - 3}px`,
                        bottom: `${segment_bottom_pct}%`,
                        height: `${Math.max(segment_height_pct, 1)}%`,
                        width: "10px",
                        backgroundColor: segment_color,
                        borderRadius: "3px",
                        transition: "bottom 0.3s ease",
                    }} />
                )}

                {/* Arrow + UTC time label */}
                {is_replay_active && (() => {
                    const mid_time = current_frame_start + (replay_config?.window_duration ?? 0) / 2;
                    const d = new Date(mid_time * 1000);
                    const date_label = d.toUTCString().slice(5, 16); // "27 Mar 2026"
                    const time_label = d.toUTCString().slice(17, 22) + " UTC"; // "14:30 UTC"
                    return (
                        <>
                            <div className="absolute" style={{
                                bottom: `${arrow_pct}%`,
                                left: "24px",
                                transform: "translateY(50%)",
                                transition: is_dragging ? "none" : "bottom 0.3s ease",
                                color: "#fff",
                                fontSize: "1rem",
                                fontWeight: 600,
                                opacity: 0.85,
                                lineHeight: 1.2,
                            }}>
                                <div>{date_label}</div>
                                <div>{time_label}</div>
                            </div>
                            <div className="absolute flex items-center" style={{
                                bottom: `${arrow_pct}%`,
                                left: "130px",
                                right: `${AXIS_RIGHT + 24}px`,
                                transform: "translateY(50%)",
                                transition: is_dragging ? "none" : "bottom 0.3s ease",
                                cursor: is_dragging ? "grabbing" : "grab",
                                paddingTop: "12px",
                                paddingBottom: "12px",
                            }}
                                onMouseEnter={() => {
                                    if (is_playing) {
                                        paused_for_hover_ref.current = true;
                                        pause();
                                    }
                                }}
                                onMouseLeave={() => {
                                    if (paused_for_hover_ref.current && !is_dragging) {
                                        paused_for_hover_ref.current = false;
                                        play(replay_config, current_frame_start);
                                    }
                                }}
                                onMouseDown={handle_arrow_mouse_down}
                            >
                                <div style={{ flex: 1, height: "4px", backgroundColor: arrow_color, opacity: 0.7 }} />
                                <div style={{
                                    width: 0, height: 0,
                                    borderTop: "5px solid transparent",
                                    borderBottom: "5px solid transparent",
                                    borderLeft: `8px solid ${arrow_color}`,
                                    opacity: 0.9,
                                }} />
                            </div>
                        </>
                    );
                })()}

                {/* Spots count */}
                {is_replay_active && (
                    <div className="absolute text-xs opacity-40" style={{
                        bottom: "4px",
                        right: `${AXIS_RIGHT + 12}px`,
                        color: colors.theme.text,
                        fontSize: "0.65rem",
                    }}>
                        {replay_spots.length} spots
                    </div>
                )}

                {/* Prompt / error when not active */}
                <div className="absolute inset-0 flex flex-col items-start justify-center gap-2" style={{ pointerEvents: 'none' }}>
                    {!is_replay_active ? (
                        is_loading
                            ? <div style={{ paddingLeft: '12px' }}>
                                <div className="inline-flex flex-col items-center gap-2 px-6 py-2 rounded-lg" style={{ backgroundColor: "#1d4ed8" }}>
                                    <svg className="animate-spin" width="28" height="28" viewBox="0 0 24 24" fill="none">
                                        <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeOpacity="0.3" />
                                        <path d="M12 2a10 10 0 0 1 10 10" stroke="white" strokeWidth="3" strokeLinecap="round" />
                                    </svg>
                                    <div className="font-bold text-lg leading-tight" style={{ color: "white" }}>
                                        <div>Loading</div>
                                        <div>spots…</div>
                                    </div>
                                </div>
                              </div>
                            : <div className="flex flex-col items-start gap-3" style={{ color: colors.theme.text, pointerEvents: 'auto', paddingLeft: '12px', maxWidth: `calc(100% - ${AXIS_RIGHT + 35}px)` }}>
                                <div className="text-left px-2 py-1 rounded-lg font-bold text-lg leading-tight"
                                    style={{ backgroundColor: "#1d4ed8", color: "white" }}>
                                    <div>Past Spots</div>
                                    <div>Motion View</div>
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={handle_play_pause}
                                        title="Start Playback"
                                        className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-base hover:opacity-80 active:opacity-60 transition-opacity"
                                        style={{ backgroundColor: "#22c55e", color: "white" }}>▶</button>
                                    <span style={{ fontSize: "1.5rem", fontWeight: 700 }}>to start</span>
                                </div>
                              </div>
                    ) : null}
                    {error && <div className="text-red-500 text-xs px-3 text-center">{error}</div>}
                </div>

                {/* FROM — pinned to bottom */}
                {!is_replay_active && (
                    <div className="absolute left-0 right-0" style={{ bottom: '8px' }}>
                        <HoursRow
                            label="From"
                            value={from_h}
                            onChange={handleFromChange}
                            colors={colors}
                            min={until_h}
                        />
                    </div>
                )}

            </div>

            {/* Play controls */}
            <div className="flex items-center justify-center gap-2 p-2 shrink-0 border-t"
                style={{ borderColor: colors.theme.borders }}>
                <ControlButton onClick={go_to_start} title="Go to start" color="#374151">⏮</ControlButton>
                <ControlButton onClick={step_backward} title="Step back">⏪</ControlButton>
                <ControlButton onClick={handle_play_pause} title={is_playing ? "Pause" : "Start Playback"}
                    color={is_playing ? "#f59e0b" : "#22c55e"}>
                    {is_playing ? "⏸" : "▶"}
                </ControlButton>
                <ControlButton onClick={step_forward} title="Step forward">⏩</ControlButton>
                <ControlButton onClick={go_to_end} title="Go to end" color="#374151">⏭</ControlButton>
                {is_replay_active && (
                    <ControlButton onClick={exit_replay} title="Exit playback" color="#ef4444">✕</ControlButton>
                )}
            </div>
        </div>
    );
}

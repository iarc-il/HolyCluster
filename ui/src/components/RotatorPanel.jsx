import { useColors } from "@/hooks/useColors";
import useRotator from "@/hooks/useRotator";
import { useEffect, useState } from "react";

const QUICK_HEADINGS = [0, 45, 90, 135, 180, 225, 270, 315];

function format_degrees(value) {
    if (value == null || !Number.isFinite(Number(value))) {
        return "--";
    }
    return `${Math.round(Number(value))}°`;
}

function bearing_point(center_x, center_y, radius, bearing) {
    const angle = (90 - Number(bearing)) * (Math.PI / 180);
    return [center_x + Math.cos(angle) * radius, center_y - Math.sin(angle) * radius];
}

function RotatorCompass({ azimuth, colors }) {
    const heading = Number.isFinite(Number(azimuth)) ? Number(azimuth) : 0;
    const pointer_color =
        colors.map.home_marker || colors.map.azimuth_line || colors.buttons.utility;
    const angle = (90 - heading) * (Math.PI / 180);
    const direction_x = Math.cos(angle);
    const direction_y = -Math.sin(angle);
    const right_x = -direction_y;
    const right_y = direction_x;
    const nose = [80 + direction_x * 56, 80 + direction_y * 56];
    const base = [80 - direction_x * 6, 80 - direction_y * 6];
    const tail = [80 - direction_x * 56, 80 - direction_y * 56];
    const left = [base[0] - right_x * 8, base[1] - right_y * 8];
    const right = [base[0] + right_x * 8, base[1] + right_y * 8];
    const tail_left = [80 - right_x * 6, 80 - right_y * 6];
    const tail_right = [80 + right_x * 6, 80 + right_y * 6];

    return (
        <div className="relative mx-auto h-44 w-44">
            <svg viewBox="0 0 160 160" className="h-full w-full" aria-hidden="true">
                <circle
                    cx="80"
                    cy="80"
                    r="72"
                    fill="none"
                    stroke={`${colors.theme.text}30`}
                    strokeWidth="2"
                />
                {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(deg => {
                    const inner = deg % 90 === 0 ? 58 : 64;
                    const outer = 72;
                    const [inner_x, inner_y] = bearing_point(80, 80, inner, deg);
                    const [outer_x, outer_y] = bearing_point(80, 80, outer, deg);
                    return (
                        <line
                            key={deg}
                            x1={inner_x}
                            y1={inner_y}
                            x2={outer_x}
                            y2={outer_y}
                            stroke={colors.theme.text}
                            strokeWidth={deg % 90 === 0 ? 2.5 : 1.5}
                            opacity={deg % 90 === 0 ? 0.8 : 0.35}
                        />
                    );
                })}
                {[
                    ["0", 80, 22],
                    ["90", 138, 85],
                    ["180", 80, 145],
                    ["270", 22, 85],
                ].map(([label, x, y]) => (
                    <text
                        key={label}
                        x={x}
                        y={y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill={colors.theme.text}
                        fontSize="12"
                        fontWeight="700"
                    >
                        {label}
                    </text>
                ))}
                <path
                    d={`M${nose[0]} ${nose[1]} L${right[0]} ${right[1]} L${base[0]} ${base[1]} L${left[0]} ${left[1]} Z`}
                    fill={pointer_color}
                />
                <path
                    d={`M${tail[0]} ${tail[1]} L${tail_left[0]} ${tail_left[1]} L${base[0]} ${base[1]} L${tail_right[0]} ${tail_right[1]} Z`}
                    fill={`${colors.theme.text}55`}
                />
                <circle cx="80" cy="80" r="7" fill={colors.theme.background} />
                <circle cx="80" cy="80" r="4" fill={pointer_color} />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div
                    className="rounded-full px-3 py-1 text-2xl font-bold tabular-nums"
                    style={{ color: colors.theme.text }}
                >
                    {format_degrees(azimuth)}
                </div>
            </div>
        </div>
    );
}

export default function RotatorPanel() {
    const { colors } = useColors();
    const { set_azimuth, is_rotator_available, rotator_status, rotator_azimuth, rotator_name } =
        useRotator();
    const [azimuth_input, set_azimuth_input] = useState("");

    useEffect(() => {
        if (rotator_azimuth != null) {
            set_azimuth_input(String(Math.round(rotator_azimuth)));
        }
    }, [rotator_azimuth]);

    const is_available = is_rotator_available();
    const status_color = is_available ? "#22c55e" : "#ef4444";

    function submit_azimuth(event) {
        event.preventDefault();
        set_azimuth(azimuth_input);
    }

    return (
        <div className="flex h-full flex-col gap-4 p-4" style={{ color: colors.theme.text }}>
            <div>
                <div className="text-xs uppercase tracking-wide opacity-70">Rotator</div>
                <div className="mt-1 flex items-center gap-2 text-sm">
                    <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: status_color }}
                        aria-hidden="true"
                    />
                    <span>{rotator_status}</span>
                    {rotator_name ? <span className="opacity-60">({rotator_name})</span> : null}
                </div>
            </div>

            <RotatorCompass azimuth={rotator_azimuth} colors={colors} />

            <div className="grid grid-cols-1 gap-2 text-sm">
                <div
                    className="rounded-lg p-3"
                    style={{ backgroundColor: `${colors.theme.text}12` }}
                >
                    <div className="text-xs opacity-65">Azimuth</div>
                    <div className="text-2xl font-bold tabular-nums">
                        {format_degrees(rotator_azimuth)}
                    </div>
                </div>
            </div>

            <form onSubmit={submit_azimuth} className="flex gap-2">
                <input
                    type="number"
                    min="0"
                    max="359"
                    step="1"
                    value={azimuth_input}
                    onChange={event => set_azimuth_input(event.target.value)}
                    className="min-w-0 flex-1 rounded-md px-3 py-2 text-sm outline-none"
                    style={{
                        backgroundColor: colors.theme.input_background,
                        border: `1px solid ${colors.theme.text}38`,
                        color: colors.theme.text,
                    }}
                    aria-label="Azimuth in degrees"
                />
                <button
                    type="submit"
                    className="rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
                    style={{
                        backgroundColor: colors.buttons.utility,
                        color: colors.theme.background,
                    }}
                    disabled={!is_available}
                >
                    Set
                </button>
            </form>

            <div className="grid grid-cols-4 gap-2">
                {QUICK_HEADINGS.map(heading => (
                    <button
                        key={heading}
                        type="button"
                        onClick={() => set_azimuth(heading)}
                        className="rounded-md py-2 text-sm font-semibold disabled:opacity-50"
                        style={{
                            backgroundColor: `${colors.theme.text}14`,
                            border: `1px solid ${colors.theme.text}24`,
                            color: colors.theme.text,
                        }}
                        disabled={!is_available}
                    >
                        {heading}°
                    </button>
                ))}
            </div>
        </div>
    );
}

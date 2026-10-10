export default function ProgressBar({ label, value, max = 100, background_color, className = "" }) {
    const determinate = Number.isFinite(value) && Number.isFinite(max) && max > 0;
    const percentage = determinate ? Math.max(0, Math.min(100, (value / max) * 100)) : null;

    return (
        <div
            className={`relative h-2 overflow-hidden rounded-full bg-slate-500/30 ${className}`}
            style={{ backgroundColor: background_color }}
        >
            <progress
                aria-label={label}
                max={max}
                value={determinate ? Math.max(0, Math.min(max, value)) : undefined}
                className="sr-only"
            />
            <div
                aria-hidden="true"
                className={`h-full rounded-full bg-green-500 transition-[width] duration-200 ${determinate ? "" : "w-full animate-pulse"}`}
                style={determinate ? { width: `${percentage}%` } : undefined}
            />
        </div>
    );
}

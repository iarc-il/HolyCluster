const PROFILE_PARAM_NAMES = ["profileMap", "benchMap", "mapProfile"];
const DEFAULT_REPORT_INTERVAL_MS = 5000;
const MAX_SAMPLES_PER_METRIC = 1000;

function get_profile_config() {
    if (typeof window === "undefined") {
        return { enabled: false, report_interval_ms: DEFAULT_REPORT_INTERVAL_MS };
    }

    const params = new URLSearchParams(window.location.search);
    const enabled = PROFILE_PARAM_NAMES.some(name => {
        if (!params.has(name)) return false;
        const value = params.get(name);
        return value == null || value === "" || value === "1" || value === "true";
    });
    const requested_interval_ms = Number(params.get("mapProfileIntervalMs"));
    const report_interval_ms =
        Number.isFinite(requested_interval_ms) && requested_interval_ms > 0
            ? requested_interval_ms
            : DEFAULT_REPORT_INTERVAL_MS;

    return { enabled, report_interval_ms };
}

const profile_config = get_profile_config();
const profile_metrics = new Map();
let last_report_time = 0;

function get_metric(label) {
    let metric = profile_metrics.get(label);
    if (!metric) {
        metric = {
            count: 0,
            total_ms: 0,
            min_ms: Infinity,
            max_ms: 0,
            last_ms: 0,
            samples: [],
        };
        profile_metrics.set(label, metric);
    }
    return metric;
}

function round_ms(value) {
    return Math.round(value * 100) / 100;
}

function percentile(sorted_samples, ratio) {
    if (sorted_samples.length === 0) return 0;
    const index = Math.min(
        sorted_samples.length - 1,
        Math.max(0, Math.ceil(sorted_samples.length * ratio) - 1),
    );
    return sorted_samples[index];
}

export function is_map_profiling_enabled() {
    return profile_config.enabled;
}

export function record_map_profile(label, duration_ms) {
    if (!profile_config.enabled) return;

    const metric = get_metric(label);
    metric.count += 1;
    metric.total_ms += duration_ms;
    metric.min_ms = Math.min(metric.min_ms, duration_ms);
    metric.max_ms = Math.max(metric.max_ms, duration_ms);
    metric.last_ms = duration_ms;
    metric.samples.push(duration_ms);
    if (metric.samples.length > MAX_SAMPLES_PER_METRIC) {
        metric.samples.shift();
    }
}

export function profile_map(label, fn) {
    if (!profile_config.enabled) return fn();

    const start = performance.now();
    try {
        return fn();
    } finally {
        record_map_profile(label, performance.now() - start);
        report_map_profile();
    }
}

export function get_map_profile_snapshot() {
    const rows = [];
    for (const [metric, data] of profile_metrics) {
        const sorted_samples = [...data.samples].sort((a, b) => a - b);
        rows.push({
            metric,
            count: data.count,
            total_ms: round_ms(data.total_ms),
            avg_ms: round_ms(data.total_ms / data.count),
            median_ms: round_ms(percentile(sorted_samples, 0.5)),
            p95_ms: round_ms(percentile(sorted_samples, 0.95)),
            max_ms: round_ms(data.max_ms),
            last_ms: round_ms(data.last_ms),
        });
    }

    return rows.sort((a, b) => b.total_ms - a.total_ms);
}

export function report_map_profile(force = false) {
    if (!profile_config.enabled) return;

    const now = performance.now();
    if (!force && now - last_report_time < profile_config.report_interval_ms) return;
    last_report_time = now;

    const rows = get_map_profile_snapshot();
    if (rows.length === 0) return;

    console.groupCollapsed(
        `[Map profile] ${rows.length} metrics, ${Math.round(now / 1000)}s since load`,
    );
    console.table(rows);
    console.groupEnd();
}

export function reset_map_profile() {
    profile_metrics.clear();
    last_report_time = performance.now();
}

if (profile_config.enabled && typeof window !== "undefined") {
    window.__mapProfile = {
        report: () => report_map_profile(true),
        reset: reset_map_profile,
        snapshot: get_map_profile_snapshot,
    };
    console.info(
        "Map profiling enabled. Use window.__mapProfile.report(), .snapshot(), or .reset().",
    );
}

import {
    compute_gaps,
    create_interval_db,
    fetch_gaps as fetch_gaps_generic,
} from "@/utils/interval_cache.js";

const DB_NAME = "holycluster_propagation_cache";
const DB_VERSION = 1;
const STORE_NAME = "intervals";
const METRICS = ["a_index", "k_index", "sfi"];
const BUCKET_MS = 30 * 60 * 1000;

const store = create_interval_db(DB_NAME, DB_VERSION, STORE_NAME);

export const subscribe = store.subscribe;
export const get_version = store.get_version;

function snap_to_bucket_start(ms) {
    return Math.floor(ms / BUCKET_MS) * BUCKET_MS;
}

function snap_to_bucket_end(ms) {
    return Math.ceil(ms / BUCKET_MS) * BUCKET_MS;
}

function empty_metrics() {
    return Object.fromEntries(METRICS.map(m => [m, []]));
}

function normalize_metrics(raw_metrics) {
    const normalized = empty_metrics();
    for (const metric of METRICS) {
        const samples = raw_metrics?.[metric];
        if (!Array.isArray(samples)) continue;
        normalized[metric] = samples
            .map(s => ({ timestamp: Math.floor(Number(s.timestamp)), value: Number(s.value) }))
            .filter(s => Number.isFinite(s.timestamp) && Number.isFinite(s.value));
    }
    return normalized;
}

function merge_metric_samples(sample_lists) {
    const seen = new Map();
    for (const samples of sample_lists) {
        for (const sample of samples) {
            if (!seen.has(sample.timestamp)) seen.set(sample.timestamp, sample);
        }
    }
    return [...seen.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function merge_covered_metrics(covered_intervals) {
    const merged = empty_metrics();
    for (const metric of METRICS) {
        merged[metric] = merge_metric_samples(
            covered_intervals.map(r => r.metrics?.[metric] ?? []),
        );
    }
    return merged;
}

function trim_metrics_to_range(metrics, start_unix, end_unix) {
    const trimmed = {};
    for (const metric of METRICS) {
        const samples = metrics[metric] ?? [];
        const in_range = samples.filter(s => s.timestamp >= start_unix && s.timestamp <= end_unix);
        const before = samples.filter(s => s.timestamp < start_unix);
        const anchor = before.length > 0 ? [before[before.length - 1]] : [];
        trimmed[metric] = [...anchor, ...in_range];
    }
    return trimmed;
}

// Pure sync read: whatever propagation samples are currently known for
// [start_ms, end_ms] (snapped to the 30-min bucket grid), plus whether that
// range is fully covered. Safe to call during render.
export function get_propagation(start_ms, end_ms) {
    const bucket_start_ms = snap_to_bucket_start(start_ms);
    const bucket_end_ms = Math.max(snap_to_bucket_end(end_ms), bucket_start_ms + BUCKET_MS);
    const covered = store.get_overlapping_intervals(bucket_start_ms, bucket_end_ms);
    const gaps = compute_gaps(bucket_start_ms, bucket_end_ms, covered);

    const start_unix = Math.floor(bucket_start_ms / 1000);
    const end_unix = Math.floor(bucket_end_ms / 1000);
    const metrics = merge_covered_metrics(covered);

    return {
        propagation_history: {
            start_time: start_unix,
            end_time: end_unix,
            metrics: trim_metrics_to_range(metrics, start_unix, end_unix),
        },
        is_complete: gaps.length === 0,
    };
}

async function fetch_gaps(send, subscribe_ws, wait_for_open, gaps, signal) {
    const results = await fetch_gaps_generic(
        send,
        subscribe_ws,
        wait_for_open,
        "propagation",
        gaps,
        signal,
        data => data.metrics,
    );
    return results.map(r => ({ start: r.start, end: r.end, raw_metrics: r.payload }));
}

// Background-only: fetches whatever's missing for [start_ms, end_ms] (bucket
// grid) and merges it in. No-ops if already fully covered. Never call this
// from a render, it's only ever invoked from an effect.
export async function ensure_propagation_loaded(
    send,
    subscribe_ws,
    wait_for_open,
    start_ms,
    end_ms,
    signal,
) {
    await store.ready();

    const bucket_start_ms = snap_to_bucket_start(start_ms);
    const bucket_end_ms = Math.max(snap_to_bucket_end(end_ms), bucket_start_ms + BUCKET_MS);
    const initial_covered = store.get_overlapping_intervals(bucket_start_ms, bucket_end_ms);
    const gaps = compute_gaps(bucket_start_ms, bucket_end_ms, initial_covered);
    if (gaps.length === 0) return;

    const gap_results = await fetch_gaps(send, subscribe_ws, wait_for_open, gaps, signal);
    const normalized_gaps = gap_results.map(g => ({
        start: g.start,
        end: g.end,
        metrics: normalize_metrics(g.raw_metrics),
    }));

    // Re-read covered intervals now, inside the write lock — see the
    // matching comment in spot_cache_db.jsx's ensure_spots_loaded for why
    // reusing the pre-fetch snapshot here would leave overlapping records
    // behind when a concurrent prefetch chain commits in the meantime.
    await store.with_lock(async () => {
        const covered = store.get_overlapping_intervals(bucket_start_ms, bucket_end_ms);
        const merged_start = Math.min(
            bucket_start_ms,
            ...covered.map(r => r.start),
            ...normalized_gaps.map(g => g.start),
        );
        const merged_end = Math.max(
            bucket_end_ms,
            ...covered.map(r => r.end),
            ...normalized_gaps.map(g => g.end),
        );

        const merged_metrics = empty_metrics();
        for (const metric of METRICS) {
            merged_metrics[metric] = merge_metric_samples([
                ...covered.map(r => r.metrics?.[metric] ?? []),
                ...normalized_gaps.map(g => g.metrics[metric]),
            ]);
        }

        await store.commit(covered, {
            start: merged_start,
            end: merged_end,
            metrics: merged_metrics,
        });
    });
}

export async function evict_old_records() {
    const cutoff = Date.now() - 5 * 86_400_000;
    await store.evict(cutoff, (record, cutoff_ms) => {
        const kept_metrics = {};
        let kept_count = 0;
        let original_count = 0;
        for (const metric of METRICS) {
            const original = record.metrics?.[metric] ?? [];
            const kept = original.filter(s => s.timestamp * 1000 >= cutoff_ms);
            kept_metrics[metric] = kept;
            kept_count += kept.length;
            original_count += original.length;
        }
        if (kept_count === 0) return null;
        if (kept_count === original_count) return record;
        return { ...record, start: Math.max(record.start, cutoff_ms), metrics: kept_metrics };
    });
}

export function open_db_and_evict() {
    return evict_old_records().catch(() => {});
}

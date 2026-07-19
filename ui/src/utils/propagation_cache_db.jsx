import {
    compute_gaps,
    create_interval_db,
    fetch_gaps as fetch_gaps_generic,
} from "@/utils/interval_cache.js";

const DB_NAME = "holycluster_propagation_cache";
const DB_VERSION = 1;
const STORE_NAME = "intervals";
const METRICS = ["a_index", "k_index", "sfi"];

const { open_db, find_overlapping_intervals } = create_interval_db(DB_NAME, DB_VERSION, STORE_NAME);

export { compute_gaps, find_overlapping_intervals, open_db };

export async function fetch_gaps(send, subscribe, wait_for_open, gaps, signal) {
    const results = await fetch_gaps_generic(
        send,
        subscribe,
        wait_for_open,
        "propagation",
        gaps,
        signal,
        data => data.metrics,
    );
    return results.map(r => ({ start: r.start, end: r.end, raw_metrics: r.payload }));
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

export function merge_covered_metrics(covered_intervals) {
    const merged = empty_metrics();
    for (const metric of METRICS) {
        merged[metric] = merge_metric_samples(
            covered_intervals.map(r => r.metrics?.[metric] ?? []),
        );
    }
    return merged;
}

export async function merge_and_store(db, covered_intervals, gap_results) {
    const normalized_gaps = gap_results.map(g => ({
        start: g.start,
        end: g.end,
        metrics: normalize_metrics(g.raw_metrics),
    }));

    const merged_start = Math.min(
        ...covered_intervals.map(r => r.start),
        ...normalized_gaps.map(g => g.start),
    );
    const merged_end = Math.max(
        ...covered_intervals.map(r => r.end),
        ...normalized_gaps.map(g => g.end),
    );

    const merged_metrics = empty_metrics();
    for (const metric of METRICS) {
        merged_metrics[metric] = merge_metric_samples([
            ...covered_intervals.map(r => r.metrics?.[metric] ?? []),
            ...normalized_gaps.map(g => g.metrics[metric]),
        ]);
    }

    const tx = db.transaction(STORE_NAME, "readwrite");
    await Promise.all([
        ...covered_intervals.map(r => tx.store.delete(r.id)),
        tx.store.add({ start: merged_start, end: merged_end, metrics: merged_metrics }),
        tx.done,
    ]);

    return merged_metrics;
}

export async function evict_old_records(db) {
    const cutoff = Date.now() - 5 * 86_400_000;
    const all_records = await db.getAll(STORE_NAME);
    const tx = db.transaction(STORE_NAME, "readwrite");

    for (const record of all_records) {
        const kept_metrics = {};
        let kept_count = 0;
        let original_count = 0;
        for (const metric of METRICS) {
            const original = record.metrics?.[metric] ?? [];
            const kept = original.filter(s => s.timestamp * 1000 >= cutoff);
            kept_metrics[metric] = kept;
            kept_count += kept.length;
            original_count += original.length;
        }
        if (kept_count === 0) {
            tx.store.delete(record.id);
        } else if (kept_count !== original_count) {
            tx.store.put({
                ...record,
                start: Math.max(record.start, cutoff),
                metrics: kept_metrics,
            });
        }
    }

    await tx.done;
}

export function open_db_and_evict() {
    return open_db()
        .then(db => evict_old_records(db))
        .catch(() => {});
}

import { useWs } from "@/hooks/useWs";
import {
    compute_gaps,
    fetch_gaps,
    find_overlapping_intervals,
    merge_and_store,
    merge_covered_metrics,
    open_db,
} from "@/utils/propagation_cache_db.jsx";
import { useCallback, useEffect, useRef, useState } from "react";

const BUCKET_MS = 30 * 60 * 1000;
const PREFETCH_WINDOWS = 3;
const METRICS = ["a_index", "k_index", "sfi"];

function snap_to_bucket_start(ms) {
    return Math.floor(ms / BUCKET_MS) * BUCKET_MS;
}

function snap_to_bucket_end(ms) {
    return Math.ceil(ms / BUCKET_MS) * BUCKET_MS;
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

export default function useHistoryPropagation(startTime, endTime) {
    const [propagation_history, set_propagation_history] = useState(null);
    const [fetch_state, set_fetch_state] = useState("idle");
    const prefetch_controllers = useRef(new Map());
    const { send, subscribe, wait_for_open } = useWs();

    const fetch_window_with_cache = useCallback(
        async (start_ms, end_ms, signal) => {
            const db = await open_db();
            const covered = await find_overlapping_intervals(db, start_ms, end_ms);
            const gaps = compute_gaps(start_ms, end_ms, covered);

            if (gaps.length === 0) return merge_covered_metrics(covered);

            const gap_results = await fetch_gaps(send, subscribe, wait_for_open, gaps, signal);
            return merge_and_store(db, covered, gap_results);
        },
        [send, subscribe, wait_for_open],
    );

    const prefetch = useCallback(
        (start_ms, end_ms) => {
            const key = `${start_ms}:${end_ms}`;
            if (prefetch_controllers.current.has(key)) return;

            const controller = new AbortController();
            prefetch_controllers.current.set(key, controller);

            open_db()
                .then(db => find_overlapping_intervals(db, start_ms, end_ms))
                .then(covered => {
                    const gaps = compute_gaps(start_ms, end_ms, covered);
                    if (gaps.length === 0) return;
                    return fetch_window_with_cache(start_ms, end_ms, controller.signal);
                })
                .catch(() => {})
                .finally(() => {
                    prefetch_controllers.current.delete(key);
                });
        },
        [fetch_window_with_cache],
    );

    useEffect(() => {
        if (!startTime || !endTime) {
            set_propagation_history(null);
            set_fetch_state("idle");
            return;
        }

        const start_ms = snap_to_bucket_start(startTime.getTime());
        const end_ms = Math.max(snap_to_bucket_end(endTime.getTime()), start_ms + BUCKET_MS);
        const start_unix = Math.floor(start_ms / 1000);
        const end_unix = Math.floor(end_ms / 1000);

        const controller = new AbortController();
        set_fetch_state("loading");

        fetch_window_with_cache(start_ms, end_ms, controller.signal)
            .then(metrics => {
                set_propagation_history({
                    start_time: start_unix,
                    end_time: end_unix,
                    metrics: trim_metrics_to_range(metrics, start_unix, end_unix),
                });
                set_fetch_state("done");

                const now_ms = Date.now();
                for (let i = 1; i <= PREFETCH_WINDOWS; i++) {
                    const next_start = end_ms + BUCKET_MS * (i - 1);
                    const next_end = next_start + BUCKET_MS;
                    if (next_end <= now_ms + 60_000) {
                        prefetch(next_start, next_end);
                    }

                    const prev_end = start_ms - BUCKET_MS * (i - 1);
                    const prev_start = prev_end - BUCKET_MS;
                    if (prev_start >= 0) {
                        prefetch(prev_start, prev_end);
                    }
                }
            })
            .catch(err => {
                if (err.name === "AbortError") return;
                console.error("Failed to fetch history propagation:", err);
                set_fetch_state("error");
            });

        return () => controller.abort();
    }, [startTime, endTime]);

    return { propagation_history, fetch_state };
}

import {
    compute_gaps,
    fetch_gaps,
    find_overlapping_intervals,
    merge_and_store,
    open_db,
} from "@/utils/spot_cache_db.js";
import { useCallback, useEffect, useRef, useState } from "react";

export default function useHistorySpots(startTime, endTime, window_size_ms, step_size_ms) {
    const [raw_spots, set_raw_spots] = useState([]);
    const [fetch_state, set_fetch_state] = useState("idle");
    const prefetch_controllers = useRef(new Map());

    const fetch_window_with_cache = useCallback(async (start_ms, end_ms, signal) => {
        const db = await open_db();
        const covered = await find_overlapping_intervals(db, start_ms, end_ms);
        const gaps = compute_gaps(start_ms, end_ms, covered);

        let all_spots;
        if (gaps.length === 0) {
            all_spots = covered.flatMap(r => r.spots);
        } else {
            const gap_results = await fetch_gaps(gaps, signal);
            all_spots = await merge_and_store(db, covered, gap_results);
        }

        return all_spots.filter(s => s.time * 1000 >= start_ms && s.time * 1000 <= end_ms);
    }, []);

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
            set_raw_spots([]);
            set_fetch_state("idle");
            return;
        }

        const start_ms = startTime.getTime();
        const end_ms = endTime.getTime();
        const step_ms = step_size_ms || window_size_ms || end_ms - start_ms;

        const controller = new AbortController();
        set_fetch_state("loading");

        fetch_window_with_cache(start_ms, end_ms, controller.signal)
            .then(spots => {
                set_raw_spots(spots);
                set_fetch_state("done");

                const now_ms = Date.now();
                const next_start = start_ms + step_ms;
                const next_end = end_ms + step_ms;
                const prev_start = start_ms - step_ms;
                const prev_end = end_ms - step_ms;

                if (next_end <= now_ms + 60_000) {
                    prefetch(next_start, next_end);
                }
                if (prev_start >= 0) {
                    prefetch(prev_start, prev_end);
                }
            })
            .catch(err => {
                if (err.name === "AbortError") return;
                console.error("Failed to fetch history spots:", err);
                set_fetch_state("error");
            });

        return () => controller.abort();
    }, [startTime, endTime]);

    return { raw_spots, fetch_state };
}

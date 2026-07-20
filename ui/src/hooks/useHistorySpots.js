import { useWs } from "@/hooks/useWs";
import { ensure_spots_loaded, get_spots, get_version, subscribe } from "@/utils/spot_cache_db.jsx";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

const PREFETCH_WINDOWS = 3;
const EMPTY_SNAPSHOT = { spots: [], is_complete: false };

export default function useHistorySpots(startTime, endTime, window_size_ms, step_size_ms) {
    const { send, subscribe: subscribe_ws, wait_for_open } = useWs();
    const prefetch_controllers = useRef(new Map());

    const start_ms = startTime ? startTime.getTime() : null;
    const end_ms = endTime ? endTime.getTime() : null;

    // Reactive sync read: version is a cheap primitive from the store, so
    // useSyncExternalStore is happy; the actual (non-trivial) snapshot
    // computation is memoized off it instead of recomputed every render.
    const version = useSyncExternalStore(subscribe, get_version);
    const snapshot = useMemo(() => {
        if (start_ms === null || end_ms === null) return EMPTY_SNAPSHOT;
        return get_spots(start_ms, end_ms);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [version, start_ms, end_ms]);

    const ensure_loaded = useCallback(
        (s, e, signal) => ensure_spots_loaded(send, subscribe_ws, wait_for_open, s, e, signal),
        [send, subscribe_ws, wait_for_open],
    );

    const prefetch = useCallback(
        (s, e) => {
            const key = `${s}:${e}`;
            if (prefetch_controllers.current.has(key)) return;

            const controller = new AbortController();
            prefetch_controllers.current.set(key, controller);

            ensure_loaded(s, e, controller.signal)
                .catch(() => {})
                .finally(() => {
                    prefetch_controllers.current.delete(key);
                });
        },
        [ensure_loaded],
    );

    useEffect(() => {
        if (start_ms === null || end_ms === null) return;

        const step_ms = step_size_ms || window_size_ms || end_ms - start_ms;
        const controller = new AbortController();

        ensure_loaded(start_ms, end_ms, controller.signal)
            .then(() => {
                const now_ms = Date.now();
                for (let i = 1; i <= PREFETCH_WINDOWS; i++) {
                    const next_start = start_ms + step_ms * i;
                    const next_end = end_ms + step_ms * i;
                    if (next_end <= now_ms + 60_000) {
                        prefetch(next_start, next_end);
                    }

                    const prev_start = start_ms - step_ms * i;
                    const prev_end = end_ms - step_ms * i;
                    if (prev_start >= 0) {
                        prefetch(prev_start, prev_end);
                    }
                }
            })
            .catch(err => {
                if (err.name === "AbortError") return;
                console.error("Failed to fetch history spots:", err);
            });

        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [start_ms, end_ms]);

    return {
        raw_spots: snapshot.spots,
        fetch_state: start_ms === null ? "idle" : snapshot.is_complete ? "done" : "loading",
        committed_start: snapshot.is_complete ? startTime : null,
        committed_end: snapshot.is_complete ? endTime : null,
    };
}

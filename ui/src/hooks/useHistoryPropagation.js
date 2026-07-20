import { useWs } from "@/hooks/useWs";
import {
    ensure_propagation_loaded,
    get_propagation,
    get_version,
    subscribe,
} from "@/utils/propagation_cache_db.jsx";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

const PREFETCH_WINDOWS = 3;
const BUCKET_MS = 30 * 60 * 1000;
const EMPTY_SNAPSHOT = { propagation_history: null, is_complete: false };

function snap_to_bucket_start(ms) {
    return Math.floor(ms / BUCKET_MS) * BUCKET_MS;
}

function snap_to_bucket_end(ms) {
    return Math.ceil(ms / BUCKET_MS) * BUCKET_MS;
}

export default function useHistoryPropagation(startTime, endTime) {
    const { send, subscribe: subscribe_ws, wait_for_open } = useWs();
    const prefetch_controllers = useRef(new Map());

    const start_ms = startTime ? startTime.getTime() : null;
    const end_ms = endTime ? endTime.getTime() : null;

    const version = useSyncExternalStore(subscribe, get_version);
    const snapshot = useMemo(() => {
        if (start_ms === null || end_ms === null) return EMPTY_SNAPSHOT;
        return get_propagation(start_ms, end_ms);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [version, start_ms, end_ms]);

    const ensure_loaded = useCallback(
        (s, e, signal) =>
            ensure_propagation_loaded(send, subscribe_ws, wait_for_open, s, e, signal),
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

        const bucket_start_ms = snap_to_bucket_start(start_ms);
        const bucket_end_ms = Math.max(snap_to_bucket_end(end_ms), bucket_start_ms + BUCKET_MS);
        const controller = new AbortController();

        ensure_loaded(start_ms, end_ms, controller.signal)
            .then(() => {
                const now_ms = Date.now();
                for (let i = 1; i <= PREFETCH_WINDOWS; i++) {
                    const next_start = bucket_end_ms + BUCKET_MS * (i - 1);
                    const next_end = next_start + BUCKET_MS;
                    if (next_end <= now_ms + 60_000) {
                        prefetch(next_start, next_end);
                    }

                    const prev_end = bucket_start_ms - BUCKET_MS * (i - 1);
                    const prev_start = prev_end - BUCKET_MS;
                    if (prev_start >= 0) {
                        prefetch(prev_start, prev_end);
                    }
                }
            })
            .catch(err => {
                if (err.name === "AbortError") return;
                console.error("Failed to fetch history propagation:", err);
            });

        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [start_ms, end_ms]);

    return {
        propagation_history: snapshot.propagation_history,
        fetch_state: start_ms === null ? "idle" : snapshot.is_complete ? "done" : "loading",
    };
}

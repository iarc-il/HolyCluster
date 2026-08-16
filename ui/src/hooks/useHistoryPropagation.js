import { useWs } from "@/hooks/useWs";
import {
    ensure_propagation_loaded,
    get_propagation,
    get_version,
    subscribe,
} from "@/utils/propagation_cache_db.jsx";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

// Matches the cache eviction cutoff in propagation_cache_db.jsx — no point
// buffering data that would just be evicted the moment it lands.
const PREFETCH_RETENTION_MS = 5 * 86_400_000;
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
    const inflight = useRef(new Set());
    const latest_request_ref = useRef(null);
    const fetch_running_ref = useRef(false);
    const chain_controller_ref = useRef(null);

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

    // Buffers one bucket at a time in a given direction — like a video
    // player filling its buffer ahead of the playhead, each fetch only kicks
    // off the next bucket once it lands, walking outward until it hits "now"
    // (forward) or the retention cutoff (backward). No fixed window count:
    // it keeps going, deduped against in-flight ranges, until the effect
    // below aborts it (the range moved on) or it runs out of bound.
    const prefetch_chain = useCallback(
        (s, e, direction, signal) => {
            const key = `${s}:${e}`;
            if (inflight.current.has(key)) return;
            inflight.current.add(key);

            ensure_loaded(s, e, signal)
                .catch(() => {})
                .finally(() => inflight.current.delete(key))
                .then(() => {
                    if (signal.aborted) return;
                    const next_s = s + BUCKET_MS * direction;
                    const next_e = e + BUCKET_MS * direction;
                    const now_ms = Date.now();
                    if (direction > 0 && next_e > now_ms + 60_000) return;
                    if (direction < 0 && next_s < now_ms - PREFETCH_RETENTION_MS) return;
                    prefetch_chain(next_s, next_e, direction, signal);
                });
        },
        [ensure_loaded],
    );

    // Only one propagation fetch is ever in flight at a time. A fast drag
    // just keeps overwriting "the range we actually want" instead of firing
    // a new WebSocket request per mousemove — when the in-flight one
    // resolves, it immediately serves whatever is newest, skipping every
    // intermediate position instead of piling up a burst of now-stale
    // requests.
    useEffect(() => {
        if (start_ms === null || end_ms === null) {
            latest_request_ref.current = null;
            return;
        }

        latest_request_ref.current = { start_ms, end_ms };

        if (fetch_running_ref.current) return;
        fetch_running_ref.current = true;

        (async () => {
            while (latest_request_ref.current) {
                const { start_ms: s, end_ms: e } = latest_request_ref.current;
                latest_request_ref.current = null;

                const bucket_start_ms = snap_to_bucket_start(s);
                const bucket_end_ms = Math.max(snap_to_bucket_end(e), bucket_start_ms + BUCKET_MS);

                chain_controller_ref.current?.abort();
                const controller = new AbortController();
                chain_controller_ref.current = controller;

                try {
                    await ensure_loaded(s, e, controller.signal);
                    prefetch_chain(bucket_end_ms, bucket_end_ms + BUCKET_MS, 1, controller.signal);
                    prefetch_chain(
                        bucket_start_ms - BUCKET_MS,
                        bucket_start_ms,
                        -1,
                        controller.signal,
                    );
                } catch (err) {
                    if (err.name !== "AbortError") {
                        console.error("Failed to fetch history propagation:", err);
                    }
                }
            }
            fetch_running_ref.current = false;
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [start_ms, end_ms]);

    return {
        propagation_history: snapshot.propagation_history,
        fetch_state: start_ms === null ? "idle" : snapshot.is_complete ? "done" : "loading",
    };
}

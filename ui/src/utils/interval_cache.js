import { openDB } from "idb";

export function create_interval_db(db_name, db_version, store_name) {
    let db_promise = null;

    function open_db() {
        if (!db_promise) {
            db_promise = openDB(db_name, db_version, {
                upgrade(db) {
                    const store = db.createObjectStore(store_name, {
                        keyPath: "id",
                        autoIncrement: true,
                    });
                    store.createIndex("idx_start", "start");
                    store.createIndex("idx_end", "end");
                },
                blocked() {
                    db_promise = null;
                },
            });
        }
        return db_promise;
    }

    async function find_overlapping_intervals(db, start_ms, end_ms) {
        const candidates = await db.getAllFromIndex(
            store_name,
            "idx_start",
            IDBKeyRange.upperBound(end_ms),
        );
        return candidates.filter(r => r.end >= start_ms).sort((a, b) => a.start - b.start);
    }

    return { store_name, open_db, find_overlapping_intervals };
}

export function compute_gaps(start_ms, end_ms, covered_intervals) {
    const gaps = [];
    let cursor = start_ms;
    for (const interval of covered_intervals) {
        if (interval.start > cursor) {
            gaps.push({ start: cursor, end: interval.start });
        }
        cursor = Math.max(cursor, interval.end);
        if (cursor >= end_ms) break;
    }
    if (cursor < end_ms) {
        gaps.push({ start: cursor, end: end_ms });
    }
    return gaps;
}

// Requests one [start_unix, end_unix] window over the shared "history" websocket
// channel, keyed by `event_name` so concurrent spots/propagation requests with the
// same time bounds never resolve each other's response.
export function fetch_window(
    send,
    subscribe,
    wait_for_open,
    event_name,
    start_unix,
    end_unix,
    signal,
    extract_value,
) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }

        const cleanup = () => {
            unsubscribe();
            signal?.removeEventListener("abort", on_abort);
        };

        const on_abort = () => {
            cleanup();
            reject(new DOMException("Aborted", "AbortError"));
        };

        const unsubscribe = subscribe("history", data => {
            if (data.event !== event_name) return;
            if (data.start_time !== start_unix || data.end_time !== end_unix) return;
            cleanup();
            resolve(extract_value(data));
        });

        signal?.addEventListener("abort", on_abort);

        wait_for_open().then(() => {
            if (signal?.aborted) return;
            send("history", { event: event_name, start_time: start_unix, end_time: end_unix });
        });
    });
}

export async function fetch_gaps(
    send,
    subscribe,
    wait_for_open,
    event_name,
    gaps,
    signal,
    extract_value,
) {
    return Promise.all(
        gaps.map(async gap => ({
            start: gap.start,
            end: gap.end,
            payload: await fetch_window(
                send,
                subscribe,
                wait_for_open,
                event_name,
                Math.floor(gap.start / 1000),
                Math.floor(gap.end / 1000),
                signal,
                extract_value,
            ),
        })),
    );
}

import { openDB } from "idb";

// A store backing one IndexedDB object store of merged time-interval records
// (spots or propagation). Reads (get_overlapping_intervals) are pure and
// synchronous, safe to call during render because they run entirely
// against an in-memory mirror that's hydrated once, in the background,
// starting the moment this module loads. Writes (commit, evict) are the only
// things that touch IndexedDB, are always async, and notify subscribers
// (via useSyncExternalStore in the hooks) when they change the mirror.
export function create_interval_db(db_name, db_version, store_name) {
    let db_promise = null;
    let records_map = new Map();
    let hydrate_promise = null;
    let version = 0;
    const listeners = new Set();

    function notify() {
        version += 1;
        for (const listener of listeners) listener();
    }

    function subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    function get_version() {
        return version;
    }

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

    function hydrate() {
        hydrate_promise = (async () => {
            const db = await open_db();
            const all = await db.getAll(store_name);
            records_map = new Map(all.map(r => [r.id, r]));
            notify();
        })();
        return hydrate_promise;
    }

    // Background writers must await this before computing gaps, so they never
    // mistake "not yet mirrored into memory" for "not cached" and re-fetch
    // from the network something that's already sitting in IndexedDB.
    function ready() {
        return hydrate_promise;
    }

    hydrate();

    // Pure sync read: no I/O, no promises. Safe to call during render.
    function get_overlapping_intervals(start_ms, end_ms) {
        return [...records_map.values()]
            .filter(r => r.start <= end_ms && r.end >= start_ms)
            .sort((a, b) => a.start - b.start);
    }

    // Background-only write: replaces covered_intervals with one merged
    // record, in IndexedDB and in the mirror, then notifies subscribers.
    async function commit(covered_intervals, new_record) {
        const db = await open_db();
        const tx = db.transaction(store_name, "readwrite");
        const add_promise = tx.store.add(new_record);
        await Promise.all([
            ...covered_intervals.map(r => tx.store.delete(r.id)),
            add_promise,
            tx.done,
        ]);
        const id = await add_promise;

        for (const r of covered_intervals) records_map.delete(r.id);
        records_map.set(id, { ...new_record, id });
        notify();
    }

    // Background-only write: trim_record(record, cutoff_ms) returns the
    // trimmed record, the same record reference if unchanged, or null to
    // delete it entirely.
    async function evict(cutoff_ms, trim_record) {
        const db = await open_db();
        const tx = db.transaction(store_name, "readwrite");
        let changed = false;

        for (const record of records_map.values()) {
            const trimmed = trim_record(record, cutoff_ms);
            if (trimmed === null) {
                tx.store.delete(record.id);
                records_map.delete(record.id);
                changed = true;
            } else if (trimmed !== record) {
                tx.store.put(trimmed);
                records_map.set(record.id, trimmed);
                changed = true;
            }
        }

        await tx.done;
        if (changed) notify();
    }

    return {
        store_name,
        subscribe,
        get_version,
        ready,
        get_overlapping_intervals,
        commit,
        evict,
    };
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

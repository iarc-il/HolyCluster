import { annotateDiagnosticError } from "@/sentry";
import { toError } from "@/utils/errors.js";
import { captureException } from "@sentry/react";
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
    let upgrade_error = null;
    let memory_only = false;
    let memory_id = 0;
    let records_map = new Map();
    let hydrate_promise = null;
    let version = 0;
    let write_queue = Promise.resolve();
    const listeners = new Set();

    // Serializes the "read covered intervals -> commit merged replacement"
    // critical section. Network fetches (slow) must NOT hold this lock —
    // only callers already awaiting store.ready() would end up serialized
    // behind them, killing prefetch parallelism. Without this, two
    // concurrent callers with overlapping-but-different ranges (e.g. the
    // forward and backward prefetch chains) can both read the same stale
    // "nothing cached yet" snapshot, fetch overlapping data independently,
    // and both commit — leaving two overlapping records behind, each
    // holding the same spots, which a later read then returns twice.
    function with_lock(fn) {
        const run = write_queue.then(fn, fn);
        write_queue = run.then(
            () => {},
            () => {},
        );
        return run;
    }

    function notify() {
        version += 1;
        for (const listener of listeners) {
            try {
                listener();
            } catch (error) {
                throw toError(error);
            }
        }
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
                upgrade(db, _old_version, _new_version, tx) {
                    // idb creates a separate completion promise for the upgrade.
                    // The open request below owns failure handling.
                    tx.done.catch(() => {});
                    try {
                        const store = db.createObjectStore(store_name, {
                            keyPath: "id",
                            autoIncrement: true,
                        });
                        store.createIndex("idx_start", "start");
                        store.createIndex("idx_end", "end");
                    } catch (error) {
                        upgrade_error = annotateDiagnosticError(error, {
                            operation: "cache_hydration",
                            database: db_name,
                            store: store_name,
                            stage: "upgrade",
                            requested_version: db_version,
                            observed_version: db.version,
                            expected_store_present: db.objectStoreNames.contains(store_name),
                        });
                        tx.abort();
                    }
                },
            });
        }
        return db_promise;
    }

    function hydrate() {
        hydrate_promise = (async () => {
            let stage = "open";
            let observed_version;
            let expected_store_present;
            try {
                const db = await open_db();
                observed_version = db.version;
                expected_store_present = db.objectStoreNames.contains(store_name);
                stage = "transaction";
                const tx = db.transaction(store_name, "readonly");
                stage = "get_all";
                const [all] = await Promise.all([tx.store.getAll(), tx.done]);
                stage = "mirror";
                records_map = new Map(all.map(r => [r.id, r]));
                stage = "notify";
                notify();
            } catch (error) {
                // An open abort leaves no trusted disk snapshot. Keep this
                // instance in memory-only mode; never overwrite unknown disk data.
                if (stage === "open" && !upgrade_error && error?.name === "AbortError") {
                    memory_only = true;
                    return;
                }
                if (upgrade_error) throw upgrade_error;
                throw annotateDiagnosticError(error, {
                    operation: "cache_hydration",
                    database: db_name,
                    store: store_name,
                    stage,
                    requested_version: db_version,
                    observed_version,
                    expected_store_present,
                });
            }
        })();
        // Eager hydration can fail before a consumer calls ready(). Keep fatal
        // failures observable without creating a global unhandled rejection.
        hydrate_promise.catch(captureException);
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
    // Callers must hold the write lock — see with_lock above — since this
    // blindly trusts covered_intervals to still be exactly what's stored.
    async function commit(covered_intervals, new_record) {
        await ready();
        let id;
        if (memory_only) {
            id = ++memory_id;
        } else {
            const db = await open_db();
            const tx = db.transaction(store_name, "readwrite");
            const add_promise = tx.store.add(new_record);
            await Promise.all([
                ...covered_intervals.map(r => tx.store.delete(r.id)),
                add_promise,
                tx.done,
            ]);
            id = await add_promise;
        }

        for (const r of covered_intervals) records_map.delete(r.id);
        records_map.set(id, { ...new_record, id });
        notify();
    }

    // Background-only write: trim_record(record, cutoff_ms) returns the
    // trimmed record, the same record reference if unchanged, or null to
    // delete it entirely. Takes the write lock itself since it iterates and
    // mutates every record, and must not interleave with a commit().
    async function evict(cutoff_ms, trim_record) {
        return with_lock(async () => {
            await ready();
            const next_records = new Map(records_map);
            const changes = [];

            for (const record of records_map.values()) {
                const trimmed = trim_record(record, cutoff_ms);
                if (trimmed === null) {
                    next_records.delete(record.id);
                    changes.push({ id: record.id, trimmed });
                } else if (trimmed !== record) {
                    next_records.set(record.id, trimmed);
                    changes.push({ id: record.id, trimmed });
                }
            }

            if (changes.length === 0) return;
            if (!memory_only) {
                const db = await open_db();
                const tx = db.transaction(store_name, "readwrite");
                await Promise.all([
                    ...changes.map(({ id, trimmed }) =>
                        trimmed === null ? tx.store.delete(id) : tx.store.put(trimmed),
                    ),
                    tx.done,
                ]);
            }
            records_map = next_records;
            notify();
        });
    }

    return {
        store_name,
        subscribe,
        get_version,
        ready,
        get_overlapping_intervals,
        commit,
        evict,
        with_lock,
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
export const HISTORY_OPEN_TIMEOUT_MS = 10_000;
export const HISTORY_RESPONSE_TIMEOUT_MS = 30_000;

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

        let unsubscribe = () => {};
        let settled = false;
        let timer;
        const opening = new AbortController();
        const cleanup = () => {
            if (settled) return false;
            settled = true;
            clearTimeout(timer);
            unsubscribe();
            signal?.removeEventListener("abort", on_abort);
            opening.abort();
            return true;
        };
        const succeed = value => {
            if (cleanup()) resolve(value);
        };
        const fail = error => {
            if (cleanup()) reject(toError(error));
        };
        const on_abort = () => fail(new DOMException("Aborted", "AbortError"));
        const timeout = phase => fail(new Error(`History ${phase} timed out`));

        signal?.addEventListener("abort", on_abort);
        timer = setTimeout(() => timeout("connection"), HISTORY_OPEN_TIMEOUT_MS);
        try {
            unsubscribe = subscribe("history", data => {
                if (data.event !== event_name) return;
                if (data.start_time !== start_unix || data.end_time !== end_unix) return;
                try {
                    succeed(extract_value(data));
                } catch (error) {
                    fail(error);
                }
            });
            // Custom transports may ignore the optional signal or return void
            // from send; only an explicit false means the send was refused.
            Promise.resolve(wait_for_open(opening.signal))
                .then(() => {
                    if (settled) return;
                    clearTimeout(timer);
                    timer = setTimeout(() => timeout("response"), HISTORY_RESPONSE_TIMEOUT_MS);
                    if (
                        send("history", {
                            event: event_name,
                            start_time: start_unix,
                            end_time: end_unix,
                        }) === false
                    ) {
                        fail(new Error("History connection is not open"));
                    }
                })
                .catch(fail);
        } catch (error) {
            fail(error);
        }
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

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    abort: false,
    open_error: null,
    opens: 0,
    capture: vi.fn(),
    get_all_error: null,
    unreadable_keys: [],
    keys_error: null,
    delete_error: null,
}));
vi.mock("@sentry/react", async importOriginal => ({
    ...(await importOriginal()),
    captureException: state.capture,
}));
vi.mock("idb", async importOriginal => {
    const actual = await importOriginal();
    return {
        ...actual,
        openDB: (name, version, options) => {
            state.opens++;
            if (state.open_error) return Promise.reject(state.open_error);
            return actual
                .openDB(name, version, {
                    ...options,
                    upgrade(...args) {
                        options.upgrade(...args);
                        if (state.abort) args[3].abort();
                    },
                })
                .then(db => ({
                    version: db.version,
                    objectStoreNames: db.objectStoreNames,
                    transaction(...args) {
                        const tx = db.transaction(...args);
                        return {
                            done: tx.done,
                            store: new Proxy(tx.store, {
                                get(target, method) {
                                    const value = Reflect.get(target, method);
                                    if (typeof value !== "function") return value;
                                    return (...args) => {
                                        const error =
                                            method === "getAll"
                                                ? state.get_all_error
                                                : method === "getAllKeys"
                                                  ? state.keys_error
                                                  : method === "delete"
                                                    ? state.delete_error
                                                    : method === "get" &&
                                                        state.unreadable_keys.includes(args[0])
                                                      ? new DOMException(
                                                            "Failed to read large IndexedDB value",
                                                            "UnknownError",
                                                        )
                                                      : null;
                                        if (!error) return value.apply(target, args);
                                        tx.abort();
                                        return Promise.reject(error);
                                    };
                                },
                            }),
                        };
                    },
                }));
        },
    };
});
import { create_interval_db } from "@/utils/interval_cache.js";

let sequence = 0;
const make_store = () => create_interval_db(`lifecycle_${sequence++}`, 1, "intervals");
afterEach(() => {
    state.abort = false;
    state.open_error = null;
    state.opens = 0;
    state.get_all_error = null;
    state.unreadable_keys = [];
    state.keys_error = null;
    state.delete_error = null;
    state.capture.mockClear();
    vi.restoreAllMocks();
});

function transport() {
    const handlers = new Set();
    return {
        subscribe: (_, handler) => {
            handlers.add(handler);
            return () => handlers.delete(handler);
        },
        send: vi.fn((_, request) => {
            queueMicrotask(() => {
                for (const handler of handlers)
                    handler({
                        ...request,
                        spots: { spots: [] },
                        metrics: { sfi: [{ timestamp: request.start_time, value: 123 }] },
                    });
            });
        }),
        wait: () => Promise.resolve(),
    };
}

describe("cache lifecycle", () => {
    it.each(["spots", "propagation"])(
        "loads %s over the network after an upgrade abort",
        async kind => {
            vi.resetModules();
            state.abort = true;
            const cache = await import(
                kind === "spots" ? "@/utils/spot_cache_db.jsx" : "@/utils/propagation_cache_db.jsx"
            );
            const load =
                kind === "spots" ? cache.ensure_spots_loaded : cache.ensure_propagation_loaded;
            const read = kind === "spots" ? cache.get_spots : cache.get_propagation;
            const ws = transport();
            const start = Date.now();
            const end = start + 3_600_000;
            const changed = vi.fn();
            cache.subscribe(changed);
            await expect(load(ws.send, ws.subscribe, ws.wait, start, end)).resolves.toBeUndefined();
            expect(read(start, end).is_complete).toBe(true);
            expect(changed).toHaveBeenCalled();
            await load(ws.send, ws.subscribe, ws.wait, start, end);
            expect(ws.send).toHaveBeenCalledTimes(1);
            await cache.evict_old_records();
            expect(read(start, end).is_complete).toBe(kind !== "spots");
            expect(state.opens).toBe(1);
            expect(state.capture).not.toHaveBeenCalled();
        },
    );

    it("keeps fallback merges and eviction in memory without retrying the aborted database", async () => {
        state.abort = true;
        const store = make_store();
        await expect(store.ready()).resolves.toBeUndefined();
        await store.with_lock(() => store.commit([], { start: 0, end: 10, data: [1] }));
        const covered = store.get_overlapping_intervals(0, 20);
        await store.with_lock(() => store.commit(covered, { start: 0, end: 20, data: [1, 2] }));
        expect(store.get_overlapping_intervals(0, 20)).toHaveLength(1);
        await store.evict(10, r => ({ ...r, start: 10, data: [2] }));
        expect(store.get_overlapping_intervals(0, 20)[0]).toMatchObject({ start: 10, data: [2] });
        await store.evict(30, () => null);
        expect(store.get_overlapping_intervals(0, 20)).toEqual([]);
        expect(state.opens).toBe(1);
    });

    it("leaves existing disk records unchanged after an open abort", async () => {
        const { openDB } = await vi.importActual("idb");
        const name = `existing_${sequence++}`;
        const disk = await openDB(name, 1, {
            upgrade(db) {
                db.createObjectStore("intervals", { keyPath: "id", autoIncrement: true });
            },
        });
        const saved = { id: 1, start: 0, end: 10, data: ["disk"] };
        await disk.put("intervals", saved);
        state.open_error = new DOMException("The operation was aborted", "AbortError");
        const store = create_interval_db(name, 1, "intervals");
        await store.ready();
        expect(store.get_overlapping_intervals(0, 10)).toEqual([]);
        await store.with_lock(() => store.commit([], { start: 0, end: 20, data: ["network"] }));
        await store.evict(30, () => null);
        expect(await disk.getAll("intervals")).toEqual([saved]);
        disk.close();
        expect(state.capture).not.toHaveBeenCalled();
    });

    it("reports eager fatal failures even without a ready consumer", async () => {
        const error = new DOMException("newer schema", "VersionError");
        state.open_error = error;
        const store = make_store();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(state.capture).toHaveBeenCalledExactlyOnceWith(error);
        await expect(store.ready()).rejects.toBe(error);
        await expect(store.evict(100, () => null)).rejects.toBe(error);
    });

    it("hydrates disk coverage before startup eviction and persists merged records", async () => {
        const { openDB } = await vi.importActual("idb");
        const name = `persistent_${sequence++}`;
        const disk = await openDB(name, 1, {
            upgrade(db) {
                db.createObjectStore("intervals", { keyPath: "id", autoIncrement: true });
            },
        });
        await disk.put("intervals", { start: 0, end: 10, data: [1] });
        const store = create_interval_db(name, 1, "intervals");
        await store.evict(5, r => ({ ...r, start: 5 }));
        const covered = store.get_overlapping_intervals(0, 20);
        expect(covered).toHaveLength(1);
        expect(covered[0].start).toBe(5);
        await store.with_lock(() => store.commit(covered, { start: 5, end: 20, data: [1, 2] }));
        expect(await disk.getAll("intervals")).toEqual(store.get_overlapping_intervals(0, 20));
        disk.close();
    });

    it("removes invalid disk records by their primary keys and keeps valid coverage", async () => {
        const { openDB } = await vi.importActual("idb");
        const name = `invalid_${sequence++}`;
        const disk = await openDB(name, 1, {
            upgrade(db) {
                db.createObjectStore("intervals");
            },
        });
        const saved = { id: 1, start: 0, end: 10, data: [1] };
        await disk.put("intervals", saved, 1);
        for (const [index, value] of [
            null,
            {},
            { id: 4, start: 20, end: 10 },
            { id: 5, start: Number.NaN, end: 30 },
            { id: 99, start: 10, end: 20 },
        ].entries()) {
            await disk.put("intervals", value, index + 2);
        }
        const store = create_interval_db(name, 1, "intervals");
        await expect(store.ready()).resolves.toBeUndefined();
        expect(store.get_overlapping_intervals(0, 100)).toEqual([saved]);
        expect(await disk.getAll("intervals")).toEqual([saved]);
        expect(state.capture).not.toHaveBeenCalled();
        disk.close();
    });

    it.each([false, true])(
        "recovers a failed bulk read (unreadable record: %s) without clearing other stores",
        async unreadable => {
            const { openDB } = await vi.importActual("idb");
            const name = `unreadable_${sequence++}`;
            const disk = await openDB(name, 1, {
                upgrade(db) {
                    db.createObjectStore("intervals", { keyPath: "id", autoIncrement: true });
                    db.createObjectStore("other");
                },
            });
            const saved = { id: 1, start: 0, end: 10, data: [1] };
            const bad = { id: 2, start: 10, end: 20, data: [2] };
            await disk.put("intervals", saved);
            await disk.put("intervals", bad);
            await disk.put("other", "untouched", 1);
            state.get_all_error = new DOMException(
                "Failed to read large IndexedDB value",
                "UnknownError",
            );
            state.unreadable_keys = unreadable ? [2] : [];
            const store = create_interval_db(name, 1, "intervals");
            await expect(store.ready()).resolves.toBeUndefined();
            expect(store.get_overlapping_intervals(0, 20)).toEqual(
                unreadable ? [saved] : [saved, bad],
            );
            expect(await disk.getAll("intervals")).toEqual(unreadable ? [saved] : [saved, bad]);
            const covered = store.get_overlapping_intervals(0, 20);
            await store.with_lock(() => store.commit(covered, { start: 0, end: 20, data: [1, 2] }));
            expect(await disk.getAll("intervals")).toEqual(store.get_overlapping_intervals(0, 20));
            expect(await disk.get("other", 1)).toBe("untouched");
            expect(state.capture).not.toHaveBeenCalled();
            disk.close();
        },
    );

    it.each([
        ["spots", false],
        ["spots", true],
        ["propagation", false],
        ["propagation", true],
    ])(
        "refetches invalid %s coverage (unreadable: %s) and persists the repair",
        async (kind, unreadable) => {
            vi.resetModules();
            const { openDB } = await vi.importActual("idb");
            const name =
                kind === "spots" ? "holycluster_spot_cache" : "holycluster_propagation_cache";
            const disk = await openDB(name, 1, {
                upgrade(db) {
                    db.createObjectStore("intervals", { keyPath: "id", autoIncrement: true });
                },
            });
            await disk.clear("intervals");
            const start = Math.floor(Date.now() / 3_600_000) * 3_600_000;
            const middle = start + 3_600_000;
            const end = middle + 3_600_000;
            const payload =
                kind === "spots"
                    ? { spots: [] }
                    : { metrics: { a_index: [], k_index: [], sfi: [] } };
            await disk.put("intervals", { start, end: middle, ...payload });
            const bad_key = await disk.put("intervals", {
                start: middle,
                end,
                ...(unreadable ? payload : {}),
            });
            if (unreadable) {
                state.get_all_error = new DOMException(
                    "Failed to read large IndexedDB value",
                    "UnknownError",
                );
                state.unreadable_keys = [bad_key];
            }
            const cache = await import(
                kind === "spots" ? "@/utils/spot_cache_db.jsx" : "@/utils/propagation_cache_db.jsx"
            );
            const load =
                kind === "spots" ? cache.ensure_spots_loaded : cache.ensure_propagation_loaded;
            const read = kind === "spots" ? cache.get_spots : cache.get_propagation;
            const ws = transport();
            await load(ws.send, ws.subscribe, ws.wait, start, end);
            expect(ws.send).toHaveBeenCalledExactlyOnceWith("history", {
                event: kind,
                start_time: middle / 1000,
                end_time: end / 1000,
            });
            expect(read(start, end).is_complete).toBe(true);
            const records = await disk.getAll("intervals");
            expect(records).toHaveLength(1);
            expect(records[0]).toMatchObject({ start, end });
            await load(ws.send, ws.subscribe, ws.wait, start, end);
            expect(ws.send).toHaveBeenCalledTimes(1);
            expect(state.capture).not.toHaveBeenCalled();
            disk.close();
        },
    );

    it("preserves unknown disk data when even the cache keys cannot be read", async () => {
        const { openDB } = await vi.importActual("idb");
        const name = `keys_${sequence++}`;
        const disk = await openDB(name, 1, {
            upgrade(db) {
                db.createObjectStore("intervals", { keyPath: "id", autoIncrement: true });
                db.createObjectStore("other");
            },
        });
        const saved = { id: 1, start: 0, end: 10 };
        await disk.put("intervals", saved);
        await disk.put("other", "untouched", 1);
        state.get_all_error = new DOMException("unreadable", "UnknownError");
        state.keys_error = state.get_all_error;
        const store = create_interval_db(name, 1, "intervals");
        await expect(store.ready()).resolves.toBeUndefined();
        expect(store.get_overlapping_intervals(0, 20)).toEqual([]);
        await store.commit([], { start: 0, end: 20 });
        expect(store.get_overlapping_intervals(0, 20)).toEqual([
            expect.objectContaining({ start: 0, end: 20 }),
        ]);
        expect(await disk.getAll("intervals")).toEqual([saved]);
        expect(await disk.get("other", 1)).toBe("untouched");
        disk.close();
    });

    it.each(["UnknownError", "AbortError"])(
        "uses memory without modifying disk when repair fails with %s",
        async error_name => {
            const { openDB } = await vi.importActual("idb");
            const name = `repair_${sequence++}`;
            const disk = await openDB(name, 1, {
                upgrade(db) {
                    db.createObjectStore("intervals", { keyPath: "id", autoIncrement: true });
                },
            });
            const saved = { id: 1, start: 0, end: 10 };
            await disk.put("intervals", saved);
            state.get_all_error = new DOMException("unreadable", "UnknownError");
            state.unreadable_keys = [1];
            state.delete_error = new DOMException("cannot repair", error_name);
            const store = create_interval_db(name, 1, "intervals");
            await expect(store.ready()).resolves.toBeUndefined();
            await store.commit([], { start: 0, end: 20 });
            expect(store.get_overlapping_intervals(0, 20)).toEqual([
                expect.objectContaining({ start: 0, end: 20 }),
            ]);
            await store.evict(30, () => null);
            expect(store.get_overlapping_intervals(0, 20)).toEqual([]);
            expect(await disk.getAll("intervals")).toEqual([saved]);
            expect(state.capture).not.toHaveBeenCalled();
            disk.close();
        },
    );

    it("keeps the mirror unchanged if persistent eviction fails", async () => {
        const store = make_store();
        await store.ready();
        await store.with_lock(() => store.commit([], { start: 0, end: 10, data: [1] }));
        const before = store.get_overlapping_intervals(0, 10);
        const version = store.get_version();
        vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(function (record) {
            const request = this.get(record.id);
            this.transaction.abort();
            return request;
        });
        await expect(store.evict(5, r => ({ ...r, start: 5 }))).rejects.toMatchObject({
            name: "AbortError",
        });
        expect(store.get_overlapping_intervals(0, 10)).toEqual(before);
        expect(store.get_version()).toBe(version);
    });

    it("does not suppress schema failures behind an upgrade AbortError", async () => {
        const error = new DOMException("invalid schema", "ConstraintError");
        vi.spyOn(IDBDatabase.prototype, "createObjectStore").mockImplementationOnce(() => {
            throw error;
        });
        const store = make_store();
        await expect(store.ready()).rejects.toBe(error);
        expect(state.capture).toHaveBeenCalledWith(error);
        await expect(store.commit([], { start: 0, end: 10 })).rejects.toBe(error);
        expect(store.get_overlapping_intervals(0, 10)).toEqual([]);
    });
});

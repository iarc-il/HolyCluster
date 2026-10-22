import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ abort: false, open_error: null, opens: 0, capture: vi.fn() }));
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
            return actual.openDB(name, version, {
                ...options,
                upgrade(...args) {
                    options.upgrade(...args);
                    if (state.abort) args[3].abort();
                },
            });
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

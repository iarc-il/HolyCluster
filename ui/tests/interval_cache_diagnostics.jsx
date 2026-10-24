import { describe, expect, it, vi } from "vitest";
const { openDB } = vi.hoisted(() => ({ openDB: vi.fn() }));
vi.mock("idb", () => ({ openDB }));
import { prepareSentryEvent } from "@/sentry";
import { create_interval_db } from "@/utils/interval_cache.js";

function diagnostic(error) {
    return prepareSentryEvent(
        { exception: { values: [{ type: error.name, value: error.message }] } },
        { originalException: error },
    ).contexts.diagnostic;
}

describe("cache hydration diagnostic observation", () => {
    it.each(["holycluster_spot_cache", "holycluster_propagation_cache"])(
        "captures getAll for %s while keeping the rejection",
        async database => {
            const error = new DOMException("K1ABC secret record", "TransactionInactiveError");
            openDB.mockImplementationOnce(async () => ({
                version: 1,
                objectStoreNames: { contains: () => true },
                transaction: () => ({
                    store: {
                        getAll: async () => {
                            throw error;
                        },
                    },
                    done: Promise.resolve(),
                }),
            }));
            const store = create_interval_db(database, 1, "intervals");
            await expect(store.ready()).rejects.toBe(error);
            expect(diagnostic(error)).toMatchObject({
                operation: "cache_hydration",
                database,
                store: "intervals",
                stage: "get_all",
                category: "TransactionInactiveError",
            });
            expect(JSON.stringify(diagnostic(error))).not.toMatch(/K1ABC|secret/);
            expect(store.get_overlapping_intervals(0, 100)).toEqual([]);
        },
    );

    it("falls back to memory when the browser cannot open IndexedDB", async () => {
        openDB.mockRejectedValueOnce(new DOMException("Internal error.", "UnknownError"));
        const store = create_interval_db("test_cache", 1, "test_records");

        await expect(store.ready()).resolves.toBeUndefined();
        await store.commit([], { start: 0, end: 100, value: ["fallback"] });
        expect(store.get_overlapping_intervals(0, 100)).toEqual([
            expect.objectContaining({ start: 0, end: 100, value: ["fallback"] }),
        ]);
    });

    it("retains the database and store names for open failures", async () => {
        const error = new DOMException("secret", "VersionError");
        openDB.mockRejectedValueOnce(error);
        const store = create_interval_db("test_cache", 1, "test_records");
        await expect(store.ready()).rejects.toBe(error);
        expect(diagnostic(error)).toMatchObject({
            stage: "open",
            category: "VersionError",
            database: "test_cache",
            store: "test_records",
        });
    });
});

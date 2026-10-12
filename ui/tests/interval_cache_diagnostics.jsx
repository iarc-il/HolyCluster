import { describe, expect, it, vi } from "vitest";
const { openDB } = vi.hoisted(() => ({ openDB: vi.fn() }));
vi.mock("idb", () => ({ openDB }));
import { sanitizeSentryEvent } from "@/sentry";
import { create_interval_db } from "@/utils/interval_cache.js";

function diagnostic(error) {
    return sanitizeSentryEvent(
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
                getAll: async () => {
                    throw error;
                },
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

    it("distinguishes open failure without exposing arbitrary database or store names", async () => {
        const error = new DOMException("secret", "VersionError");
        openDB.mockRejectedValueOnce(error);
        const store = create_interval_db("K1ABC", 1, "secret");
        await expect(store.ready()).rejects.toBe(error);
        expect(diagnostic(error)).toMatchObject({
            stage: "open",
            category: "VersionError",
        });
        expect(diagnostic(error)).not.toHaveProperty("database");
        expect(diagnostic(error)).not.toHaveProperty("store");
    });
});

import { describe, expect, it } from "vitest";

import {
    normalize_propagation_history,
    select_propagation_for_time,
} from "@/utils/propagation_history.js";

describe("normalize_propagation_history", () => {
    it("normalizes metric samples and sorts them by timestamp", () => {
        const history = normalize_propagation_history({
            start_time: "100",
            end_time: "300",
            metrics: {
                a_index: [
                    { timestamp: 250, value: "7" },
                    { timestamp: 150, value: 6 },
                    { timestamp: "bad", value: 8 },
                    { timestamp: 200, value: "bad" },
                ],
                k_index: [{ timestamp: 100, value: 2.33 }],
            },
        });

        expect(history.start_time).toBe(100);
        expect(history.end_time).toBe(300);
        expect(history.metrics.a_index).toEqual([
            { timestamp: 150, value: 6 },
            { timestamp: 250, value: 7 },
        ]);
        expect(history.metrics.k_index).toEqual([{ timestamp: 100, value: 2.33 }]);
        expect(history.metrics.sfi).toEqual([]);
    });
});

describe("select_propagation_for_time", () => {
    const history = {
        start_time: 100,
        end_time: 400,
        metrics: {
            a_index: [
                { timestamp: 100, value: 5 },
                { timestamp: 300, value: 7 },
            ],
            k_index: [
                { timestamp: 90, value: 1.33 },
                { timestamp: 200, value: 2.67 },
            ],
            sfi: [
                { timestamp: 80, value: 118 },
                { timestamp: 250, value: 121 },
            ],
        },
    };

    it("selects samples at an exact timestamp", () => {
        expect(select_propagation_for_time(history, 300)).toEqual({
            a_index: { timestamp: 300, value: 7 },
            k_index: { timestamp: 200, value: 2.67 },
            sfi: { timestamp: 250, value: 121 },
        });
    });

    it("selects the latest samples before a time between timestamps", () => {
        expect(select_propagation_for_time(history, new Date(225_000))).toEqual({
            a_index: { timestamp: 100, value: 5 },
            k_index: { timestamp: 200, value: 2.67 },
            sfi: { timestamp: 80, value: 118 },
        });
    });

    it("returns null when a required metric is missing", () => {
        expect(
            select_propagation_for_time(
                {
                    metrics: {
                        a_index: [{ timestamp: 100, value: 5 }],
                        k_index: [{ timestamp: 100, value: 2 }],
                    },
                },
                200,
            ),
        ).toBeNull();
    });

    it("returns null before the first complete propagation sample set", () => {
        expect(select_propagation_for_time(history, 50)).toBeNull();
    });

    it("returns null for invalid playback time", () => {
        expect(select_propagation_for_time(history, "not a time")).toBeNull();
    });
});

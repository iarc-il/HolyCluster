import { expect, it, vi } from "vitest";

import { band_plans } from "@/data/band_plans.js";
import raw_band_plans from "../../shared/band_plans.json";

it("uses canonical JSON bounds in kHz and transforms ranges and features", () => {
    const raw = raw_band_plans[40];
    expect(band_plans[40]).toMatchObject({ min: raw.freq_start, max: raw.freq_end });
    expect(band_plans[40].ranges).toContainEqual({
        name: "cw",
        min: raw.modes.CW.start,
        max: raw.modes.CW.end,
        color: "#ff8e23",
    });
    expect(band_plans[40].features).toContainEqual({
        name: "FT8",
        freq: raw.modes.FT8.start,
        color: "#FF0000",
    });
});

it("hides FT2 and FM while preserving unknown modes with a fallback color", async () => {
    vi.resetModules();
    vi.doMock("../../shared/band_plans.json", () => ({
        default: {
            test: {
                freq_start: 100,
                freq_end: 200,
                modes: {
                    FT2: { start: 110, end: 111 },
                    FM: { start: 120, end: 130 },
                    FUTURE: { start: 140, end: 150 },
                },
            },
        },
    }));
    try {
        const { band_plans: plans } = await import("@/data/band_plans.js");
        expect(plans.test.ranges).toEqual([]);
        expect(plans.test.features).toEqual([{ name: "FUTURE", freq: 140, color: "#888888" }]);
    } finally {
        vi.doUnmock("../../shared/band_plans.json");
        vi.resetModules();
    }
});

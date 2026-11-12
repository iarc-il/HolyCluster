import { describe, expect, it } from "vitest";

import {
    normalize_selected_band,
    scroll_frequency_range,
    zoom_frequency_range,
} from "@/components/FrequencyBar.jsx";

describe("FrequencyBar band selection", () => {
    it("normalizes numeric option values without changing named bands", () => {
        expect(normalize_selected_band("20")).toBe(20);
        expect(normalize_selected_band("-1")).toBe(-1);
        expect(normalize_selected_band("VHF")).toBe("VHF");
    });
});

describe("FrequencyBar viewport", () => {
    const full_range = { min: 14, max: 14.4 };

    it("scrolls toward higher frequencies and stops at the band edge", () => {
        expect(scroll_frequency_range(full_range, 100, 14, 14.4)).toEqual(full_range);

        const scrolled = scroll_frequency_range({ min: 14.1, max: 14.3 }, 100, 14, 14.4);
        expect(scrolled.min).toBeCloseTo(14.12);
        expect(scrolled.max).toBeCloseTo(14.32);
    });

    it("zooms around the pointer and keeps the viewport in the band", () => {
        const zoomed = zoom_frequency_range(full_range, 0.25, -100, 14, 14.4);

        expect(zoomed.min).toBeGreaterThanOrEqual(14);
        expect(zoomed.max).toBeLessThanOrEqual(14.4);
        expect(zoomed.max - zoomed.min).toBeLessThan(0.4);
        expect(zoomed.min + (zoomed.max - zoomed.min) * 0.25).toBeCloseTo(14.1);
    });
});

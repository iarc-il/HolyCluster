import { describe, expect, it } from "vitest";

import {
    calculate_geographic_azimuth,
    get_spots_center,
    is_matching_list,
    is_same_base_callsign,
    km_to_miles,
    sort_spots,
} from "@/utils.js";

describe("km_to_miles", () => {
    it("converts kilometers to miles", () => {
        expect(km_to_miles(1)).toBe(1);
        expect(km_to_miles(100)).toBe(62);
        expect(km_to_miles(1000)).toBe(621);
    });

    it("returns 0 for 0 km", () => {
        expect(km_to_miles(0)).toBe(0);
    });
});

describe("calculate_geographic_azimuth", () => {
    it("returns 0 for same point", () => {
        const result = calculate_geographic_azimuth(40, -75, 40, -75);
        expect(result).toBe(0);
    });

    it("returns roughly north", () => {
        const result = calculate_geographic_azimuth(40, -75, 50, -75);
        expect(result).toBeCloseTo(0, 0);
    });

    it("returns roughly south", () => {
        const result = calculate_geographic_azimuth(40, -75, 30, -75);
        expect(result).toBeCloseTo(180, -1);
    });

    it("returns roughly east", () => {
        const result = calculate_geographic_azimuth(40, -75, 40, -65);
        expect(result).toBeCloseTo(90, -1);
    });

    it("returns a value in [0, 360)", () => {
        const result = calculate_geographic_azimuth(40, -75, 50, -65);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThan(360);
    });
});

describe("get_spots_center", () => {
    it("returns null for empty spots", () => {
        expect(get_spots_center([])).toBeNull();
    });

    it("returns the center of a single spot", () => {
        const spots = [{ spotter_loc: [-75, 40], dx_loc: [-75, 40] }];
        const center = get_spots_center(spots);
        expect(center[0]).toBe(-75);
        expect(center[1]).toBe(40);
    });

    it("averages spotter and DX locations", () => {
        const spots = [{ spotter_loc: [-75, 40], dx_loc: [-65, 50] }];
        const center = get_spots_center(spots);
        expect(center[0]).toBe((-75 + -65) / 2);
        expect(center[1]).toBe((40 + 50) / 2);
    });
});

describe("is_same_base_callsign", () => {
    it("matches same callsign", () => {
        expect(is_same_base_callsign("N0CALL", "N0CALL")).toBe(true);
    });

    it("matches base callsign ignoring suffix", () => {
        expect(is_same_base_callsign("N0CALL/P", "N0CALL")).toBe(true);
    });

    it("matches base callsign ignoring prefix", () => {
        expect(is_same_base_callsign("P/N0CALL", "N0CALL")).toBe(true);
    });

    it("returns false for different callsigns", () => {
        expect(is_same_base_callsign("N0CALL", "K1ABC")).toBe(false);
    });

    it("returns false for empty callsign", () => {
        expect(is_same_base_callsign("", "K1ABC")).toBe(false);
    });
});

describe("is_matching_list", () => {
    const spot = {
        dx_callsign: "K1ABC",
        spotter_callsign: "N0CALL",
        dx_country: "USA",
        spotter_country: "Canada",
        comment: "Nice DX",
        mode: "CW",
        band: 20,
        dx_cq_zone: 5,
        dx_itu_zone: 8,
        dx_state: "CA",
        is_dxpedition: false,
        dx_loc: [-75, 40],
    };

    it("matches a prefix filter on DX callsign", () => {
        const filters = [{ type: "prefix", value: "K1", spotter_or_dx: "dx", action: "show_only" }];
        expect(is_matching_list(filters, spot)).toBe(true);
    });

    it("does not match a non-matching prefix filter", () => {
        const filters = [{ type: "prefix", value: "K2", spotter_or_dx: "dx", action: "show_only" }];
        expect(is_matching_list(filters, spot)).toBe(false);
    });

    it("matches a suffix filter", () => {
        const filters = [{ type: "suffix", value: "BC", spotter_or_dx: "dx", action: "show_only" }];
        expect(is_matching_list(filters, spot)).toBe(true);
    });

    it("matches an entity filter on DX country", () => {
        const filters = [
            { type: "entity", value: "USA", spotter_or_dx: "dx", action: "show_only" },
        ];
        expect(is_matching_list(filters, spot)).toBe(true);
    });

    it("matches a comment filter", () => {
        const filters = [{ type: "comment", value: "nice", action: "show_only" }];
        expect(is_matching_list(filters, spot)).toBe(true);
    });

    it("matches a self-spotter filter", () => {
        const self_spot = { ...spot, dx_callsign: "N0CALL", spotter_callsign: "N0CALL" };
        const filters = [{ type: "self_spotters", action: "hide" }];
        expect(is_matching_list(filters, self_spot)).toBe(true);
    });

    it("returns false for an empty filter list", () => {
        expect(is_matching_list([], spot)).toBe(false);
    });
});

describe("sort_spots", () => {
    const spots = [
        {
            id: 1,
            freq: 14.1,
            band: 20,
            mode: "CW",
            dx_callsign: "K1ABC",
            spotter_callsign: "N0CALL",
            time: 1000,
        },
        {
            id: 2,
            freq: 7.05,
            band: 40,
            mode: "SSB",
            dx_callsign: "G1ABC",
            spotter_callsign: "M0CALL",
            time: 2000,
        },
        {
            id: 3,
            freq: 21.2,
            band: 15,
            mode: "CW",
            dx_callsign: "JA1ABC",
            spotter_callsign: "JF1ABC",
            time: 3000,
        },
    ];

    it("sorts by time descending by default", () => {
        const sorted = sort_spots(spots, { column: "time", ascending: false });
        expect(sorted[0].id).toBe(3);
        expect(sorted[2].id).toBe(1);
    });

    it("sorts by time ascending", () => {
        const sorted = sort_spots(spots, { column: "time", ascending: true });
        expect(sorted[0].id).toBe(1);
        expect(sorted[2].id).toBe(3);
    });

    it("sorts by freq descending", () => {
        const sorted = sort_spots(spots, { column: "freq", ascending: false });
        expect(sorted[0].freq).toBe(21.2);
        expect(sorted[2].freq).toBe(7.05);
    });

    it("sorts by callsign alphabetically", () => {
        const sorted = sort_spots(spots, { column: "dx_callsign", ascending: true });
        expect(sorted[0].dx_callsign).toBe("G1ABC");
        expect(sorted[2].dx_callsign).toBe("K1ABC");
    });

    it("does not mutate the original array", () => {
        const copy = [...spots];
        sort_spots(spots, { column: "time", ascending: false });
        expect(spots).toEqual(copy);
    });
});

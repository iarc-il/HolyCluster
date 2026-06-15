import { describe, expect, it } from "vitest";

import {
    enrich_spot_zones_if_missing,
    has_valid_enriched_value,
    normalize_band,
    trim_spots_to_last_hour,
} from "@/hooks/useSpotWebSocket.js";

describe("normalize_band", () => {
    it("returns VHF for band 2", () => {
        expect(normalize_band(2)).toBe("VHF");
    });

    it("returns UHF for band 0.7", () => {
        expect(normalize_band(0.7)).toBe("UHF");
    });

    it("returns SHF for bands below 1", () => {
        expect(normalize_band(0.23)).toBe("SHF");
        expect(normalize_band(0.5)).toBe("SHF");
    });

    it("returns the band itself for normal HF bands", () => {
        expect(normalize_band(20)).toBe(20);
        expect(normalize_band(40)).toBe(40);
        expect(normalize_band(160)).toBe(160);
    });
});

describe("has_valid_enriched_value", () => {
    it("returns false for undefined", () => {
        expect(has_valid_enriched_value(undefined)).toBe(false);
    });

    it("returns false for null", () => {
        expect(has_valid_enriched_value(null)).toBe(false);
    });

    it("returns false for empty string", () => {
        expect(has_valid_enriched_value("")).toBe(false);
    });

    it("returns false for -1", () => {
        expect(has_valid_enriched_value(-1)).toBe(false);
    });

    it("returns false for the string '-1'", () => {
        expect(has_valid_enriched_value("-1")).toBe(false);
    });

    it("returns true for valid values", () => {
        expect(has_valid_enriched_value(0)).toBe(true);
        expect(has_valid_enriched_value(5)).toBe(true);
        expect(has_valid_enriched_value("FN20")).toBe(true);
    });
});

describe("enrich_spot_zones_if_missing", () => {
    const base_spot = {
        dx_cq_zone: 14,
        dx_itu_zone: 28,
        spotter_cq_zone: 5,
        spotter_itu_zone: 8,
        dx_state: "CA",
        spotter_state: "NY",
        dx_dxcc_code: 291,
        spotter_dxcc_code: 291,
        dx_loc: [-75, 40],
        spotter_loc: [-74, 41],
    };

    it("returns the same spot when all values are present", () => {
        const result = enrich_spot_zones_if_missing(base_spot);
        expect(result).toBe(base_spot);
    });

    it("fills missing dx_cq_zone", () => {
        const spot = { ...base_spot, dx_cq_zone: null };
        const result = enrich_spot_zones_if_missing(spot);
        expect(result.dx_cq_zone).toBeTypeOf("number");
        expect(result.dx_cq_zone).not.toBeNull();
        expect(result).not.toBe(spot);
    });

    it("fills missing dx_state for USA", () => {
        const spot = { ...base_spot, dx_state: null };
        const result = enrich_spot_zones_if_missing(spot);
        expect(result.dx_state).toBeTypeOf("string");
        expect(result).not.toBe(spot);
    });

    it("returns same object when no enrichment is needed", () => {
        const result = enrich_spot_zones_if_missing(base_spot);
        expect(result).toBe(base_spot);
    });
});

describe("trim_spots_to_last_hour", () => {
    it("keeps spots within the last hour", () => {
        const now = Math.round(Date.now() / 1000);
        const spots = [{ time: now - 600 }, { time: now - 1800 }, { time: now - 3000 }];
        const result = trim_spots_to_last_hour(spots);
        expect(result).toHaveLength(3);
    });

    it("removes spots older than one hour", () => {
        const now = Math.round(Date.now() / 1000);
        const spots = [{ time: now - 600 }, { time: now - 4000 }];
        const result = trim_spots_to_last_hour(spots);
        expect(result).toHaveLength(1);
        expect(result[0].time).toBe(now - 600);
    });

    it("returns empty array for all-old spots", () => {
        const now = Math.round(Date.now() / 1000);
        const spots = [{ time: now - 7200 }];
        const result = trim_spots_to_last_hour(spots);
        expect(result).toHaveLength(0);
    });
});

import { check_hunter_needed } from "@/hooks/useSpotFiltering.js";

function make_spot(overrides) {
    return {
        dx_dxcc_code: 291,
        dx_cq_zone: 5,
        dx_itu_zone: 8,
        dx_state: "CA",
        ...overrides,
    };
}

function make_hunter(enabled = {}, worked = {}) {
    return {
        enabled_sections: {
            dxcc: false,
            cq_zone: false,
            itu_zone: false,
            us_state: false,
            ca_province: false,
            ...enabled,
        },
        worked: {
            dxcc: { global: [] },
            cq_zone: { global: [] },
            itu_zone: { global: [] },
            us_state: { global: [] },
            ca_province: { global: [] },
            ...worked,
        },
    };
}

describe("check_hunter_needed", () => {
    it("returns null when all sections are disabled", () => {
        expect(check_hunter_needed(make_spot(), make_hunter())).toBeNull();
    });

    it("returns null when all matching features are worked", () => {
        const hunter = make_hunter({ dxcc: true }, { dxcc: { global: [291] } });
        expect(check_hunter_needed(make_spot(), hunter)).toBeNull();
    });

    it("marks a spot needed when a feature is missing", () => {
        const hunter = make_hunter({ dxcc: true }, { dxcc: { global: [1] } });
        const result = check_hunter_needed(make_spot(), hunter);
        expect(result).not.toBeNull();
        expect(result.is_needed).toBe(true);
        expect(result.reasons).toEqual([
            { section: "dxcc", value: 291, label: "Needed DXCC: USA" },
        ]);
    });

    it("ignores disabled sections even if features are missing", () => {
        const hunter = make_hunter({ dxcc: false }, { dxcc: { global: [] } });
        expect(check_hunter_needed(make_spot(), hunter)).toBeNull();
    });

    it("matches CQ zone", () => {
        const hunter = make_hunter({ cq_zone: true }, { cq_zone: { global: [3] } });
        const result = check_hunter_needed(make_spot({ dx_cq_zone: 5 }), hunter);
        expect(result.reasons[0]).toEqual({
            section: "cq_zone",
            value: 5,
            label: "Needed CQ Zone: 5",
        });
    });

    it("matches ITU zone", () => {
        const hunter = make_hunter({ itu_zone: true }, { itu_zone: { global: [6] } });
        const result = check_hunter_needed(make_spot({ dx_itu_zone: 8 }), hunter);
        expect(result.reasons[0]).toEqual({
            section: "itu_zone",
            value: 8,
            label: "Needed ITU Zone: 8",
        });
    });

    it("matches US state", () => {
        const hunter = make_hunter({ us_state: true }, { us_state: { global: ["NY"] } });
        const result = check_hunter_needed(
            make_spot({ dx_dxcc_code: 291, dx_state: "CA" }),
            hunter,
        );
        expect(result.reasons[0]).toEqual({
            section: "us_state",
            value: "CA",
            label: "Needed US State: CA",
        });
    });

    it("returns null for US state when country is not USA", () => {
        const hunter = make_hunter({ us_state: true }, { us_state: { global: [] } });
        expect(
            check_hunter_needed(make_spot({ dx_dxcc_code: 1, dx_state: "ON" }), hunter),
        ).toBeNull();
    });

    it("matches Canada province", () => {
        const hunter = make_hunter({ ca_province: true }, { ca_province: { global: ["QC"] } });
        const result = check_hunter_needed(
            make_spot({ dx_dxcc_code: 1, dx_state: "ON", dx_cq_zone: 4, dx_itu_zone: 4 }),
            hunter,
        );
        expect(result.reasons[0]).toEqual({
            section: "ca_province",
            value: "ON",
            label: "Needed CA Province: ON",
        });
    });

    it("collects multiple reasons for multiple missing features", () => {
        const hunter = make_hunter(
            { dxcc: true, cq_zone: true },
            { dxcc: { global: [1] }, cq_zone: { global: [3] } },
        );
        const result = check_hunter_needed(make_spot({ dx_cq_zone: 5 }), hunter);
        expect(result.reasons).toHaveLength(2);
        expect(result.reasons[0].section).toBe("dxcc");
        expect(result.reasons[1].section).toBe("cq_zone");
    });

    it("matches Alaska/Hawaii spots for us_state when DXCC is Alaska/Hawaii", () => {
        const hunter = make_hunter({ us_state: true }, { us_state: { global: [] } });
        expect(
            check_hunter_needed(make_spot({ dx_dxcc_code: 6, dx_state: "AK" }), hunter).reasons[0]
                .value,
        ).toBe("AK");
        expect(
            check_hunter_needed(make_spot({ dx_dxcc_code: 110, dx_state: "HI" }), hunter).reasons[0]
                .value,
        ).toBe("HI");
    });
});

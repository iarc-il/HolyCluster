import { describe, expect, it, vi } from "vitest";

vi.mock("virtual:cty-dxcc-entities", () => ({
    default: ["United States", "Canada"],
    dxcc_entities_by_code: {
        1: { code: 1, raw_cty_name: "Canada", continent: "NA" },
        291: { code: 291, raw_cty_name: "United States", continent: "NA" },
    },
    dxcc_code_entities: {
        1: "Canada",
        291: "United States",
    },
}));

import { build_hunter_overlay_highlights } from "@/components/CanvasMap/overlay_highlights.js";
import { create_default_hunter } from "@/utils/profile_data.js";

describe("build_hunter_overlay_highlights", () => {
    it("builds alert highlights for all enabled missing hunter values", () => {
        const hunter = create_default_hunter();
        hunter.enabled_sections = {
            dxcc: true,
            cq_zone: true,
            itu_zone: true,
            us_state: true,
            ca_province: true,
        };
        hunter.worked.dxcc.global = [291];
        hunter.worked.cq_zone.global = [5];
        hunter.worked.itu_zone.global = [8];
        hunter.worked.us_state.global = ["CA"];
        hunter.worked.ca_province.global = ["ON"];

        const highlights = build_hunter_overlay_highlights(hunter);

        expect(highlights.dxcc.get(1)).toBe("alert");
        expect(highlights.dxcc.has(291)).toBe(false);
        expect(highlights.zones.cq.get(1)).toBe("alert");
        expect(highlights.zones.cq.has(5)).toBe(false);
        expect(highlights.zones.itu.get(1)).toBe("alert");
        expect(highlights.zones.itu.has(8)).toBe(false);
        expect(highlights.zones.us_state.get("AL")).toBe("alert");
        expect(highlights.zones.us_state.has("CA")).toBe(false);
        expect(highlights.zones.ca_province.get("AB")).toBe("alert");
        expect(highlights.zones.ca_province.has("ON")).toBe(false);
        expect(highlights.key).toContain("itu=1:alert");
    });

    it("ignores disabled hunter sections", () => {
        const hunter = create_default_hunter();
        const highlights = build_hunter_overlay_highlights(hunter);

        expect(highlights.dxcc.size).toBe(0);
        expect(highlights.zones.itu.size).toBe(0);
    });
});

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

import {
    build_missing_overlay_highlights,
    get_active_missing_filter_actions,
} from "@/components/CanvasMap/overlay_highlights.js";
import { create_default_missing } from "@/utils/profile_data.js";

describe("build_missing_overlay_highlights", () => {
    it("builds highlights for selected missing missing values", () => {
        const missing = create_default_missing();
        missing.worked.dxcc.global = [291];
        missing.worked.cq_zone.global = [5];
        missing.worked.itu_zone.global = [8];
        missing.worked.us_state.global = ["CA"];
        missing.worked.ca_province.global = ["ON"];

        const highlights = build_missing_overlay_highlights(missing, [
            { section: "dxcc", action: "alert" },
            { section: "cq_zone", action: "show_only" },
            { section: "itu_zone", action: "hide" },
            { section: "us_state", action: "alert" },
            { section: "ca_province", action: "alert" },
        ]);

        expect(highlights.dxcc.get(1)).toBe("alert");
        expect(highlights.dxcc.has(291)).toBe(false);
        expect(highlights.zones.cq.get(1)).toBe("show_only");
        expect(highlights.zones.cq.has(5)).toBe(false);
        expect(highlights.zones.itu.get(1)).toBe("hide");
        expect(highlights.zones.itu.has(8)).toBe(false);
        expect(highlights.zones.us_state.get("AL")).toBe("alert");
        expect(highlights.zones.us_state.has("CA")).toBe(false);
        expect(highlights.zones.ca_province.get("AB")).toBe("alert");
        expect(highlights.zones.ca_province.has("ON")).toBe(false);
        expect(highlights.key).toContain("itu=1:hide");
    });

    it("returns empty highlights without selected missing sections", () => {
        const missing = create_default_missing();
        const highlights = build_missing_overlay_highlights(missing);

        expect(highlights.dxcc.size).toBe(0);
        expect(highlights.zones.itu.size).toBe(0);
    });

    it("returns active missing filter actions", () => {
        const actions = get_active_missing_filter_actions({
            is_alert_filters_active: false,
            is_show_only_filters_active: true,
            is_hide_filters_active: true,
            filters: [
                { action: "alert", type: "missing", missing_section: "dxcc" },
                { action: "show_only", type: "missing", missing_section: "cq_zone" },
                { action: "hide", type: "missing", missing_section: "itu_zone" },
                { action: "hide", type: "prefix", value: "K", spotter_or_dx: "dx" },
            ],
        });

        expect(actions).toEqual([
            { section: "cq_zone", action: "show_only" },
            { section: "itu_zone", action: "hide" },
        ]);
    });
});

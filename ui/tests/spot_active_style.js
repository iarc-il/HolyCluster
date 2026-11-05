import { describe, expect, it } from "vitest";

import { get_active_spot_table_style } from "@/components/SpotsTable.jsx";

const colors = {
    normal_background: "#182229",
    normal_text: "#eae7ec",
    band: "#22c55e",
    light_band: "#58d67d",
    band_text: "#000000",
};

describe("active spot table style", () => {
    it("uses a subtle row preview for hover", () => {
        expect(
            get_active_spot_table_style({
                ...colors,
                is_previewed: true,
                is_pinned: false,
                is_radio_match: false,
            }),
        ).toEqual({
            background_color: "color-mix(in srgb, #182229 88%, #58d67d)",
            text_color: "#eae7ec",
            edge_style: "inset 2px 0 0 #22c55e",
            frequency_style: undefined,
        });
    });

    it("reserves the full band tint for pinned spots", () => {
        expect(
            get_active_spot_table_style({
                ...colors,
                is_previewed: true,
                is_pinned: true,
                is_radio_match: false,
            }),
        ).toEqual({
            background_color: "#58d67d",
            text_color: "#000000",
            edge_style: "inset 4px 0 0 #22c55e",
            frequency_style: undefined,
        });
    });

    it("marks only the frequency cell for radio matches", () => {
        expect(
            get_active_spot_table_style({
                ...colors,
                is_previewed: false,
                is_pinned: false,
                is_radio_match: true,
            }),
        ).toEqual({
            background_color: "#182229",
            text_color: "#eae7ec",
            edge_style: undefined,
            frequency_style: "inset 0 -2px 0 #3b82f6",
        });
    });
});

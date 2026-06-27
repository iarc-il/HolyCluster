import { describe, expect, it } from "vitest";

import { normalize_dxcc_entity_value, normalize_dxcc_label } from "@/data/dxcc_labels.js";

describe("normalize_dxcc_label", () => {
    it("normalizes CTY country names to frontend/backend labels", () => {
        expect(normalize_dxcc_label("Sov Mil Order of Malta")).toBe(
            "Sovereign Military Order of Malta",
        );
        expect(normalize_dxcc_label("United States")).toBe("USA");
        expect(normalize_dxcc_label("Fed. Rep. of Germany")).toBe("Germany");
        expect(normalize_dxcc_label("Dem. Rep. of the Congo")).toBe(
            "Democratic Republic of the Congo",
        );
        expect(normalize_dxcc_label("Republic of the Congo")).toBe("Congo");
    });

    it("normalizes abbreviated map labels", () => {
        expect(normalize_dxcc_label("Agalega & St. Brandon Is.")).toBe(
            "Agalega and St. Brandon Islands",
        );
        expect(normalize_dxcc_label("St. Peter & St. Paul")).toBe("St. Peter and St. Paul Rocks");
        expect(normalize_dxcc_label("N.Z. Subantarctic Is.")).toBe("Auckland & Campbell Islands");
    });

    it("normalizes filter comparison values", () => {
        expect(normalize_dxcc_entity_value(" Wallis & Futuna Is. ")).toBe(
            "wallis and futuna islands",
        );
    });
});

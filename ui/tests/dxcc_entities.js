import { describe, expect, it, vi } from "vitest";

vi.mock("virtual:cty-dxcc-entities", () => ({
    default: ["United States", "Fed. Rep. of Germany", "Canada"],
    dxcc_entities_by_code: {
        1: { code: 1, raw_cty_name: "Canada", continent: "NA" },
        230: { code: 230, raw_cty_name: "Fed. Rep. of Germany", continent: "EU" },
        291: { code: 291, raw_cty_name: "United States", continent: "NA" },
    },
    dxcc_code_entities: {
        1: "Canada",
        230: "Fed. Rep. of Germany",
        291: "United States",
    },
}));

import {
    build_dxcc_entity_by_code,
    get_dxcc_label,
    normalize_dxcc_code,
} from "@/data/dxcc_entities.js";

describe("dxcc_entities", () => {
    it("normalizes CTY DXCC code mappings to frontend labels", () => {
        expect(
            build_dxcc_entity_by_code({
                230: "Fed. Rep. of Germany",
                291: "United States",
                999: "",
                bad: "Italy",
                0: "Canada",
            }),
        ).toEqual({
            230: "Germany",
            291: "USA",
        });
    });

    it("rejects non-primitive DXCC values without coercing them", () => {
        const recursive = { toString: () => String(recursive) };

        expect(normalize_dxcc_code(recursive)).toBeNull();
        expect(normalize_dxcc_code([291])).toBeNull();
    });

    it.each([1, "001", " 291 ", 999])("accepts a DXCC code: %s", value => {
        expect(normalize_dxcc_code(value)).toBe(Number(value));
    });

    it.each([0, -1, 1.5, 1000, "0001", "1e2", "+1", "1.0", "１２３", "", null])(
        "rejects an invalid DXCC code: %s",
        value => {
            expect(normalize_dxcc_code(value)).toBeNull();
        },
    );

    it("returns empty label for unknown DXCC codes", () => {
        expect(get_dxcc_label(999)).toBe("");
        expect(get_dxcc_label("bad")).toBe("");
    });
});

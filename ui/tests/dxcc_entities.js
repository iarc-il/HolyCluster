import { describe, expect, it, vi } from "vitest";

vi.mock("virtual:cty-dxcc-entities", () => ({
    default: [],
    dxcc_code_entities: {},
}));

import { build_dxcc_entity_by_code, get_dxcc_entity_for_code } from "@/data/dxcc_entities.js";

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

    it("returns no entity for unknown DXCC codes", () => {
        expect(get_dxcc_entity_for_code(999)).toBeNull();
        expect(get_dxcc_entity_for_code("bad")).toBeNull();
    });
});

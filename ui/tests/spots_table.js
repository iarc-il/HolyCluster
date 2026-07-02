import { describe, expect, it } from "vitest";

import { get_tour_row_index } from "@/components/SpotsTable.jsx";

describe("spots table tour row", () => {
    it("chooses a row near the middle of the visible table", () => {
        expect(get_tour_row_index(20, 312)).toBe(4);
    });

    it("chooses the last row when there are not enough spots", () => {
        expect(get_tour_row_index(3, 312)).toBe(2);
    });

    it("does not choose a row without spots", () => {
        expect(get_tour_row_index(0, 312)).toBe(-1);
    });
});

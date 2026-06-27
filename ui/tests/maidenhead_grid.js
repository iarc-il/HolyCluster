import { describe, expect, it } from "vitest";

import { get_maidenhead_locator_label } from "@/components/CanvasMap/draw_map.js";

describe("maidenhead grid", () => {
    it("formats 2, 4, and 6 character locator labels", () => {
        expect(get_maidenhead_locator_label(-75, 40, 2)).toBe("FN");
        expect(get_maidenhead_locator_label(-75, 40, 4)).toBe("FN20");
        expect(get_maidenhead_locator_label(-75, 40, 6)).toBe("FN20MA");
    });

    it("handles world edges", () => {
        expect(get_maidenhead_locator_label(-180, -90, 2)).toBe("AA");
        expect(get_maidenhead_locator_label(-180, -90, 6)).toBe("AA00AA");
        expect(get_maidenhead_locator_label(179.999, 89.999, 6)).toBe("RR99XX");
        expect(get_maidenhead_locator_label(180, 0, 2)).toBe("RJ");
        expect(get_maidenhead_locator_label(180, 0, 4)).toBe("RJ90");
    });
});

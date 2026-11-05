import { describe, expect, it } from "vitest";

import { sanitize_callsign_filters } from "@/utils/filter_url_state.js";

describe("LoTW filter state", () => {
    it("keeps a LoTW user filter without status criteria", () => {
        const result = sanitize_callsign_filters({
            filters: [{ action: "show_only", type: "lotw", value: "frequent" }],
        });

        expect(result.filters).toEqual([{ action: "show_only", type: "lotw" }]);
    });
});

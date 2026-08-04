import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LoTWStatus } from "@/components/SpotsTable.jsx";
import { normalize_spots } from "@/utils/spot_cache_db.jsx";

afterEach(cleanup);

describe("LoTWStatus", () => {
    it.each([
        ["frequent", "LoTW: active (last upload within 180 days)", "LoTW ✓"],
        ["infrequent", "LoTW: user, last upload over 180 days ago", "LoTW ~"],
        ["non_user", "LoTW: no user activity found", "LoTW —"],
        [undefined, "LoTW status unavailable", "LoTW ?"],
        ["unexpected", "LoTW status unavailable", "LoTW ?"],
    ])("exposes %s status with text and tooltip", (status, label, text) => {
        render(<LoTWStatus status={status} />);

        const indicator = screen.getByRole("img", { name: label });
        expect(indicator.textContent).toBe(text);
        expect(indicator.getAttribute("title")).toBe(label);
    });
});

describe("historical spot normalization", () => {
    it("preserves the LoTW status supplied by the API", () => {
        const [spot] = normalize_spots([
            {
                time: 1_700_000_000,
                spotter_callsign: "K1ABC",
                dx_callsign: "K2ABC",
                dx_lotw_status: "infrequent",
                mode: "FT8",
                band: 20,
                dx_dxcc_code: 291,
                spotter_dxcc_code: 291,
                dx_continent: "NA",
                spotter_continent: "NA",
            },
        ]);

        expect(spot.dx_lotw_status).toBe("infrequent");
    });
});

import { describe, expect, it } from "vitest";

import { parseCtyCountryNames } from "../scripts/cty_entities.js";

describe("parseCtyCountryNames", () => {
    it("extracts unique CTY country names", () => {
        const csv_text = [
            "3DA,Kingdom of Eswatini,468,AF,38,57,-26.65,-31.48,-2.0,3DA;",
            "I,Italy,248,EU,15,28,42.82,-12.58,-1.0,4U I;",
            "3DA,Kingdom of Eswatini,468,AF,38,57,-26.65,-31.48,-2.0,3DA;",
            "malformed,row",
        ].join("\n");

        expect(parseCtyCountryNames(csv_text)).toEqual(["Italy", "Kingdom of Eswatini"]);
    });

    it("maps starred rows to the canonical country for the DXCC code", () => {
        const csv_text = [
            "I,Italy,248,EU,15,28,42.82,-12.58,-1.0,4U I;",
            "*IT9,Sicily,248,EU,15,28,37.50,-14.00,-1.0,IT9;",
        ].join("\n");

        expect(parseCtyCountryNames(csv_text)).toEqual(["Italy"]);
    });

    it("handles quoted CSV fields", () => {
        const csv_text = 'Q,"Quoted, Country",999,EU,15,28,0,0,0,Q;';

        expect(parseCtyCountryNames(csv_text)).toEqual(["Quoted, Country"]);
    });
});

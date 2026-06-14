import { describe, expect, it } from "vitest";

import { parseCtyCountryNames, parseCtyDxccCodeEntities } from "../scripts/cty_entities.js";

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

    it("maps DXCC codes to active canonical countries", () => {
        const csv_text = [
            "K,United States,291,NA,5,8,37.53,91.67,5.0,K;",
            "DL,Fed. Rep. of Germany,230,EU,14,28,51.00,-10.00,-1.0,DA DB DC DD;",
            "*TEST,Test Island,291,NA,5,8,37.53,91.67,5.0,TEST;",
            "BAD,Missing Code,,EU,14,28,0,0,0,BAD;",
        ].join("\n");

        expect(parseCtyDxccCodeEntities(csv_text)).toEqual({
            230: "Fed. Rep. of Germany",
            291: "United States",
        });
    });

    it("does not create code mappings from starred rows without canonical active countries", () => {
        const csv_text = "*IT9,Sicily,248,EU,15,28,37.50,-14.00,-1.0,IT9;";

        expect(parseCtyDxccCodeEntities(csv_text)).toEqual({});
    });

    it("handles quoted CSV fields", () => {
        const csv_text = 'Q,"Quoted, Country",999,EU,15,28,0,0,0,Q;';

        expect(parseCtyCountryNames(csv_text)).toEqual(["Quoted, Country"]);
    });
});

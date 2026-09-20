import { describe, expect, it } from "vitest";

import { normalize_dxcc_label } from "@/data/dxcc_labels.js";
import { get_flag } from "@/data/flags.js";
import { loadCtyCountryNames } from "../scripts/cty_entities.js";

describe("flags", () => {
    it("provides a flag for every country in the CTY file", async () => {
        const { country_names } = await loadCtyCountryNames();
        const countries_without_flags = country_names
            .map(country => [country, normalize_dxcc_label(country)])
            .filter(([, translated_country]) => get_flag(translated_country) === null)
            .map(([country, translated_country]) => `${country} -> ${translated_country}`);

        expect(countries_without_flags).toEqual([]);
    });
});

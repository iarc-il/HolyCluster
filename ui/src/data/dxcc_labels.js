import { shorten_dxcc } from "@/data/flags.js";

const DXCC_ENTITY_ALIASES = {
    "Agalega & St. Brandon": "Agalega and St. Brandon Islands",
    "Agalega & St. Brandon Is.": "Agalega and St. Brandon Islands",
    "Andaman & Nicobar Is.": "Andaman and Nicobar Islands",
    "Antigua & Barbuda": "Antigua and Barbuda",
    "Auckland & Campbell Is.": "Auckland & Campbell Islands",
    "Baker & Howland Is.": "Baker Howland Islands",
    "Baker & Howland Islands": "Baker Howland Islands",
    "Banaba I. (Ocean I.)": "Banaba Island",
    "Bosnia-Herzegovina": "Bosnia and Herzegovina",
    Bouvet: "Bouvet Island",
    "Brunei Darussalam": "Brunei",
    "C. Kiribati (British Phoenix Is.)": "Central Kiribati",
    "Central Africa": "Central African Republic",
    "Ceuta & Melilla": "Ceuta and Melilla",
    "Cote d'Ivoire": "Ivory Coast",
    "Cote de'Ivoire": "Ivory Coast",
    "Dem. Rep. of the Congo": "Democratic Republic of the Congo",
    "Democratic People's Rep. of Korea": "North Korea",
    "DPR of Korea": "North Korea",
    "E. Kiribati (Line Is.)": "Eastern Kiribati",
    "Fed. Rep. of Germany": "Germany",
    "Federal Republic of Germany": "Germany",
    "Juan de Nova & Europa": "Juan de Nova, Europa",
    "Kingdom of Eswatini": "Eswatini",
    Macedonia: "North Macedonia",
    "New Zealand Subantarctic Islands": "Auckland & Campbell Islands",
    "Peter 1 I.": "Peter I Island",
    "Republic of Korea": "South Korea",
    "Republic of Kosovo": "Kosovo",
    "Republic of South Sudan": "South Sudan",
    "Republic of the Congo": "Congo",
    "San Andres & Providencia": "San Andres and Providencia",
    "San Felix & San Ambrosio": "San Felix Islands",
    "South Shetland Is.": "Antarctica",
    "South Sudan (Republic of)": "South Sudan",
    "Sov Mil Order of Malta": "Sovereign Military Order of Malta",
    "St Maarten": "Sint Maarten",
    "St. Barthelemy": "Saint Barthelemy",
    "St. Kitts & Nevis": "St. Kitts and Nevis",
    "St. Lucia": "Saint Lucia",
    "St. Martin": "Saint Martin",
    "St. Peter & St. Paul": "St. Peter and St. Paul Rocks",
    "St. Peter & St. Paul Rocks": "St. Peter and St. Paul Rocks",
    "St. Pierre & Miquelon": "Saint Pierre and Miquelon",
    "St. Vincent": "Saint Vincent and the Grenadines",
    Swaziland: "Eswatini",
    "Timor - Leste": "Timor-Leste",
    "Trinidad & Tobago": "Trinidad and Tobago",
    "Trindade & Martim Vaz": "Trindade & Martim Vaz Islands",
    "Tristan da Cunha & Gough I.": "Tristan da Cunha & Gough Islands",
    "Turks & Caicos Is.": "Turks and Caicos Islands",
    "N.Z. Subantarctic Is.": "Auckland & Campbell Islands",
    "Pr. Edward & Marion Is.": "Prince Edward & Marion Islands",
    "United States": "United States of America",
    Vatican: "Vatican City",
    "Viet Nam": "Vietnam",
    "W. Kiribati (Gilbert Is.)": "Western Kiribati",
    "Wallis & Futuna Is.": "Wallis and Futuna Islands",
    "Wallis & Futuna Islands": "Wallis and Futuna Islands",
};

function expand_dxcc_island_abbreviations(dxcc_name) {
    return dxcc_name
        .replace(/\bIs\./g, "Islands")
        .replace(/\bI\./g, "Island")
        .replace(/\s+/g, " ")
        .trim();
}

export function normalize_dxcc_label(dxcc_name) {
    if (typeof dxcc_name !== "string") return "";

    const trimmed_name = dxcc_name.trim();
    if (!trimmed_name) return "";

    const entity_name =
        DXCC_ENTITY_ALIASES[trimmed_name] ?? expand_dxcc_island_abbreviations(trimmed_name);
    return shorten_dxcc(entity_name);
}

export function normalize_dxcc_entity_value(value) {
    return normalize_dxcc_label(value).toLowerCase();
}

import flags from "@/assets/flags.json";

const dxcc_to_country_flag = {
    "Czech Republic": "Czechia",
    "Slovak Republic": "Slovakia",
    "European Russia": "Russia",
    "Asiatic Russia": "Russia",
    Kaliningrad: "Russia",
    Sardinia: "Italy",
    "Madeira Islands": "Portugal",
    Azores: "Portugal",
    "Virgin Islands": "United States Virgin Islands",
    "St. Kitts and Nevis": "Saint Kitts and Nevis",
    "Ceuta and Melilla": "Spain",
    "Canary Islands": "Spain",
    "Balearic Islands": "Spain",
    "Rodriguez Island": "Mauritius",
    "Reunion Island": "France",
    "Aland Islands": "Åland Islands",
    "East Malaysia": "Malaysia",
    "West Malaysia": "Malaysia",
    "St. Helena": "Saint Helena, Ascension and Tristan da Cunha",
    Bonaire: "Caribbean Netherlands",
    Curacao: "Caribbean Netherlands",
    "Chatham Islands": "New Zealand",
    "United Nations HQ": "United Nations",
    "ITU HQ": "United Nations",
    "Kure Island": "United States Minor Outlying Islands",
    "Wake Island": "United States Minor Outlying Islands",
    "Mariana Islands": "United States Minor Outlying Islands",
    "Guantanamo Bay": "USA",
    Alaska: "USA",
    Corsica: "France",
    "Wallis and Futuna Islands": "France",
    "North Cook Islands": "Cook Islands",
    "Galapagos Islands": "Ecuador",
    Svalbard: "Norway",
    "Jan Mayen": "Svalbard and Jan Mayen",
    Crete: "Greece",
    "The Gambia": "Gambia",
    "Eastern Kiribati": "Kiribati",
    "Western Kiribati": "Kiribati",
    "Minami Torishima": "Japan",
    Dodecanese: "Greece",
    "Banaba Island": "Kiribati",
    "Tristan da Cunha & Gough Islands": "Saint Helena, Ascension and Tristan da Cunha",
    "Ascension Island": "Saint Helena, Ascension and Tristan da Cunha",
    "Pitcairn Island": "Pitcairn Islands",
    "Vatican City": "Vatican City (Holy See)",
    "Temotu Province": "Solomon Islands",
    Congo: "Republic of the Congo",
    "Macquarie Island": "Australia",
    "Saint Barthelemy": "France",
    Macao: "Macau",
    "Malpelo Island": "Colombia",
    Eswatini: "Eswatini (Swaziland)",
    "Market Reef": "Åland Islands",
    "UK Sovereign Base Areas on Cyprus": "Cyprus",
    "Sao Tome & Principe": "São Tomé and Príncipe",
    "United Nations HQ": "UN Headquarters",
};

const dxcc_to_short_dxcc = {
    "Czech Republic": "Czechia",
    "International Telecommunication Union Headquarters": "ITU Headquarters",
    "Slovak Republic": "Slovakia",
    "United Arab Emirates": "UAE",
    "United Nations Headquarters": "UN Headquarters",
    "United States of America": "USA",
};

export function get_flag(dx_country) {
    if (dxcc_to_country_flag[dx_country]) {
        return flags[dxcc_to_country_flag[dx_country]];
    } else if (flags[dx_country]) {
        return flags[dx_country];
    } else {
        return null;
    }
}

export function shorten_dxcc(dx_country) {
    let shorted = dxcc_to_short_dxcc[dx_country];
    if (shorted) {
        return shorted;
    } else {
        return dx_country;
    }
}

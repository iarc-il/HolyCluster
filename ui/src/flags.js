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
    "Guantanamo Bay": "United States of America",
    Alaska: "United States of America",
    Corsica: "France",
    "Wallis and Futuna Islands": "France",
    "North Cook Islands": "Cook Islands",
    "Galapagos Islands": "Ecuador",
    Svalbard: "Norway",
    "Jan Mayen": "Svalbard and Jan Mayen",
    Crete: "Greece",
    "The Gambia": "Gambia",
    "Eastern Kiribati": "Kiribati",
    "Minami Torishima": "Japan",
    Dodecanese: "Greece",
    "Banaba Island": "Kiribati",
    "Tristan da Cunha & Gough Islands": "Saint Helena, Ascension and Tristan da Cunha",
    "Pitcairn Island": "Pitcairn Islands",
    "Vatican City": "Vatican City (Holy See)",
    "Temotu Province": "Solomon Islands",
    Congo: "Republic of the Congo",
    "Macquarie Island": "Australia",
    "Saint Barthelemy": "France",
    "Macao": "Macau",
    "Malpelo Island": "Colombia",
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

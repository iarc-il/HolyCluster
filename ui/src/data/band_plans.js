const ft8_color = "#FF0000";
const ft4_color = "#0000FF";
const ssb_color = "#189f18";
const cw_color = "#ff8e23";

export const band_plans = {
    160: {
        min: 1800,
        max: 2000,
        ranges: [
            { name: "cw", min: 1800, max: 1840, color: cw_color },
            { name: "ssb", min: 1840, max: 2000, color: ssb_color },
        ],
        features: [{ name: "FT8", freq: 1840, color: ft8_color }],
    },
    80: {
        min: 3500,
        max: 4000,
        ranges: [
            { name: "cw", min: 3500, max: 3600, color: cw_color },
            { name: "ssb", min: 3600, max: 4000, color: ssb_color },
        ],
        features: [
            { name: "FT8", freq: 3573, color: ft8_color },
            { name: "FT4", freq: 3575, color: ft4_color },
        ],
    },
    60: {
        min: 5351,
        max: 5366,
        ranges: [
            { name: "cw", min: 5351, max: 5354, color: cw_color },
            { name: "ssb", min: 5354, max: 5366, color: ssb_color },
        ],
        features: [{ name: "FT8", freq: 5375, color: ft8_color }],
    },
    40: {
        min: 7000,
        max: 7300,
        ranges: [
            { name: "cw", min: 7000, max: 7040, color: cw_color },
            { name: "ssb", min: 7040, max: 7300, color: ssb_color },
        ],
        features: [
            { name: "FT8", freq: 7074, color: ft8_color },
            { name: "FT4", freq: 7047, color: ft4_color },
        ],
    },
    30: {
        min: 10100,
        max: 10150,
        ranges: [
            { name: "cw", min: 10100, max: 10130, color: cw_color },
            { name: "ssb", min: 10130, max: 10150, color: ssb_color },
        ],
        features: [
            { name: "FT8", freq: 10136, color: ft8_color },
            { name: "FT4", freq: 10140, color: ft4_color },
        ],
    },
    20: {
        min: 14000,
        max: 14350,
        ranges: [
            { name: "cw", min: 14000, max: 14101, color: cw_color },
            { name: "ssb", min: 14101, max: 14350, color: ssb_color },
        ],
        features: [
            { name: "FT8", freq: 14074, color: ft8_color },
            { name: "FT4", freq: 14080, color: ft4_color },
        ],
    },
    17: {
        min: 18068,
        max: 18168,
        ranges: [
            { name: "cw", min: 18068, max: 18111, color: cw_color },
            { name: "ssb", min: 18111, max: 18168, color: ssb_color },
        ],
        features: [
            { name: "FT8", freq: 18100, color: ft8_color },
            { name: "FT4", freq: 18104, color: ft4_color },
        ],
    },
    15: {
        min: 21000,
        max: 21450,
        ranges: [
            { name: "cw", min: 21000, max: 21151, color: cw_color },
            { name: "ssb", min: 21151, max: 21450, color: ssb_color },
        ],
        features: [
            { name: "FT8", freq: 21074, color: ft8_color },
            { name: "FT4", freq: 21140, color: ft4_color },
        ],
    },
    12: {
        min: 24890,
        max: 24990,
        ranges: [
            { name: "cw", min: 24890, max: 24931, color: cw_color },
            { name: "ssb", min: 24931, max: 24990, color: ssb_color },
        ],
        features: [
            { name: "FT8", freq: 24915, color: ft8_color },
            { name: "FT4", freq: 24919, color: ft4_color },
        ],
    },
    10: {
        min: 28000,
        max: 29700,
        ranges: [
            { name: "cw", min: 28000, max: 28320, color: cw_color },
            { name: "ssb", min: 28320, max: 29700, color: ssb_color },
        ],
        features: [
            { name: "FT8", freq: 28074, color: ft8_color },
            { name: "FT4", freq: 28180, color: ft4_color },
        ],
    },
    6: {
        min: 50000,
        max: 52000,
        ranges: [
            { name: "cw", min: 50000, max: 50100, color: cw_color },
            { name: "ssb", min: 50100, max: 52000, color: ssb_color },
        ],
        features: [
            { name: "FT8", freq: 50313, color: ft8_color },
            { name: "FT4", freq: 50318, color: ft4_color },
        ],
    },
    4: {
        min: 70000,
        max: 70500,
        ranges: [
            { name: "cw", min: 70100, max: 70250, color: cw_color },
            { name: "ssb", min: 70250, max: 70500, color: ssb_color },
        ],
        features: [{ name: "FT8", freq: 70100, color: ft8_color }],
    },
    VHF: {
        min: 144000,
        max: 144300,
        ranges: [
            { name: "cw", min: 144000, max: 144100, color: cw_color },
            { name: "ssb", min: 144100, max: 144300, color: ssb_color },
        ],
        features: [
            { name: "FT8", freq: 144175.5, color: ft8_color },
            { name: "FT4", freq: 144171.5, color: ft4_color },
        ],
    },
    UHF: {
        min: 432000,
        max: 433000,
        ranges: [
            { name: "cw", min: 432000, max: 432100, color: cw_color },
            { name: "ssb", min: 432100, max: 433000, color: ssb_color },
        ],
        features: [{ name: "FT4", freq: 432175.5, color: ft4_color }],
    },
};

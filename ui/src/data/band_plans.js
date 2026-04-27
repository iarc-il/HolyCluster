import raw_band_plans from "../../../shared/band_plans.json";

const mode_colors = {
    CW: "#ff8e23",
    SSB: "#189f18",
    RTTY: "#9b59b6",
    FM: "#00bcd4",
    FT8: "#FF0000",
    FT4: "#0000FF",
    FT2: "#ff69b4",
};

const range_modes = new Set(["CW", "SSB", "RTTY", "FM"]);
const hidden_modes = new Set(["FT2", "FM"]);

export const band_plans = Object.fromEntries(
    Object.entries(raw_band_plans).map(([band, info]) => {
        const ranges = [];
        const features = [];

        for (const [mode, freq] of Object.entries(info.modes)) {
            if (hidden_modes.has(mode)) continue;
            const color = mode_colors[mode] || "#888888";
            if (range_modes.has(mode)) {
                ranges.push({ name: mode.toLowerCase(), min: freq.start, max: freq.end, color });
            } else {
                features.push({ name: mode, freq: freq.start, color });
            }
        }

        return [band, { min: info.freq_start, max: info.freq_end, ranges, features }];
    }),
);

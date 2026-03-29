import { shorten_dxcc } from "@/data/flags.js";
import { modes, continents } from "@/data/filters_data.js";

let replay_id_counter = 2_000_000;

function normalize_band(band) {
    if (band == 2) return "VHF";
    if (band == 0.7) return "UHF";
    if (band < 1) return "SHF";
    return band;
}

function normalize_spots(spots) {
    return spots
        .map(spot => ({
            ...spot,
            id: replay_id_counter++,
            band: normalize_band(spot.band),
            mode: spot.mode === "DIGITAL" ? "DIGI" : spot.mode,
            dx_country: shorten_dxcc(spot.dx_country),
            spotter_country: shorten_dxcc(spot.spotter_country),
        }))
        .filter(spot => {
            if (!modes.includes(spot.mode)) return false;
            if (!continents.includes(spot.dx_continent)) return false;
            if (!continents.includes(spot.spotter_continent)) return false;
            return true;
        });
}

self.onmessage = function (e) {
    try {
        const parsed = JSON.parse(e.data);
        const spots = normalize_spots(parsed);
        self.postMessage({ ok: true, spots });
    } catch (err) {
        self.postMessage({ ok: false, error: err.message });
    }
};

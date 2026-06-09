import { continents, modes } from "@/data/filters_data.js";
import { shorten_dxcc } from "@/data/flags.js";
import { useCallback, useEffect, useRef, useState } from "react";

function normalize_band(band) {
    if (band === 2) return "VHF";
    if (band === 0.7) return "UHF";
    if (band < 1) return "SHF";
    return band;
}

function normalize_spots(spots, id_ref) {
    return spots
        .map(spot => {
            spot.id = id_ref.current++;
            if (spot.mode === "DIGITAL") spot.mode = "DIGI";
            spot.band = normalize_band(spot.band);
            spot.dx_country = shorten_dxcc(spot.dx_country);
            spot.spotter_country = shorten_dxcc(spot.spotter_country);
            return spot;
        })
        .filter(spot => {
            if (!modes.includes(spot.mode)) return false;
            if (!continents.includes(spot.dx_continent)) return false;
            if (!continents.includes(spot.spotter_continent)) return false;
            return true;
        });
}

async function fetch_window(start_unix, end_unix, signal) {
    const res = await fetch(`/history?start_time=${start_unix}&end_time=${end_unix}`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.spots;
}

// In-memory cache: key = "start_unix:end_unix" → normalized spots array
const spot_cache = new Map();

export default function useHistorySpots(startTime, endTime, window_size_ms) {
    const [raw_spots, set_raw_spots] = useState([]);
    const [fetch_state, set_fetch_state] = useState("idle");
    const next_id_ref = useRef(1_000_000);
    const prefetch_controllers = useRef(new Map());

    const get_or_fetch = useCallback(async (start_ms, end_ms, signal) => {
        const key = `${Math.floor(start_ms / 1000)}:${Math.floor(end_ms / 1000)}`;
        if (spot_cache.has(key)) return spot_cache.get(key);

        const raw = await fetch_window(
            Math.floor(start_ms / 1000),
            Math.floor(end_ms / 1000),
            signal,
        );
        const normalized = normalize_spots(raw, next_id_ref);
        spot_cache.set(key, normalized);
        return normalized;
    }, []);

    // Prefetch a window silently; abort any previous prefetch for same key
    const prefetch = useCallback(
        (start_ms, end_ms) => {
            const key = `${Math.floor(start_ms / 1000)}:${Math.floor(end_ms / 1000)}`;
            if (spot_cache.has(key)) return;
            if (prefetch_controllers.current.has(key)) return;

            const controller = new AbortController();
            prefetch_controllers.current.set(key, controller);

            get_or_fetch(start_ms, end_ms, controller.signal)
                .catch(() => {
                    // Silence prefetch errors (abort, network, etc.)
                })
                .finally(() => {
                    prefetch_controllers.current.delete(key);
                });
        },
        [get_or_fetch],
    );

    useEffect(() => {
        if (!startTime || !endTime) {
            set_raw_spots([]);
            set_fetch_state("idle");
            return;
        }

        const start_ms = startTime.getTime();
        const end_ms = endTime.getTime();
        const win = window_size_ms || end_ms - start_ms;

        const controller = new AbortController();
        set_fetch_state("loading");

        get_or_fetch(start_ms, end_ms, controller.signal)
            .then(spots => {
                set_raw_spots(spots);
                set_fetch_state("done");

                // Prefetch next and previous windows
                const now_ms = Date.now();
                const next_start = end_ms;
                const next_end = end_ms + win;
                const prev_start = start_ms - win;
                const prev_end = start_ms;

                if (next_end <= now_ms + 60_000) {
                    prefetch(next_start, next_end);
                }
                if (prev_start >= 0) {
                    prefetch(prev_start, prev_end);
                }
            })
            .catch(err => {
                if (err.name === "AbortError") return;
                console.error("Failed to fetch history spots:", err);
                set_fetch_state("error");
            });

        return () => controller.abort();
    }, [startTime, endTime]);

    return { raw_spots, fetch_state };
}

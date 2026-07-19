import { continents, modes } from "@/data/filters_data.js";
import {
    compute_gaps,
    create_interval_db,
    fetch_gaps as fetch_gaps_generic,
} from "@/utils/interval_cache.js";
import { normalize_spot_dxcc_fields } from "@/utils/spot_dxcc.js";

const DB_NAME = "holycluster_spot_cache";
const DB_VERSION = 1;
const STORE_NAME = "intervals";

const { open_db, find_overlapping_intervals } = create_interval_db(DB_NAME, DB_VERSION, STORE_NAME);

export { compute_gaps, find_overlapping_intervals, open_db };

export async function fetch_gaps(send, subscribe, wait_for_open, gaps, signal) {
    const results = await fetch_gaps_generic(
        send,
        subscribe,
        wait_for_open,
        "spots",
        gaps,
        signal,
        data => data.spots.spots,
    );
    return results.map(r => ({ start: r.start, end: r.end, raw_spots: r.payload }));
}

function normalize_band(band) {
    if (band === 2) return "VHF";
    if (band === 0.7) return "UHF";
    if (band < 1) return "SHF";
    return band;
}

export function normalize_spots(spots) {
    return spots
        .map(spot => {
            // Derive a stable numeric id from the backend's unique key
            spot.id = `${spot.time}|${spot.spotter_callsign}|${spot.dx_callsign}`;
            if (spot.mode === "DIGITAL") spot.mode = "DIGI";
            spot.band = normalize_band(spot.band);
            return normalize_spot_dxcc_fields(spot);
        })
        .filter(spot => {
            if (!spot.dx_dxcc_code || !spot.spotter_dxcc_code) return false;
            if (!modes.includes(spot.mode)) return false;
            if (!continents.includes(spot.dx_continent)) return false;
            if (!continents.includes(spot.spotter_continent)) return false;
            return true;
        });
}

export async function merge_and_store(db, covered_intervals, gap_results) {
    const normalized_gaps = gap_results.map(g => ({
        start: g.start,
        end: g.end,
        spots: normalize_spots(g.raw_spots),
    }));

    const merged_start = Math.min(
        ...covered_intervals.map(r => r.start),
        ...normalized_gaps.map(g => g.start),
    );
    const merged_end = Math.max(
        ...covered_intervals.map(r => r.end),
        ...normalized_gaps.map(g => g.end),
    );

    const seen = new Set();
    const deduped = [];
    for (const spot of [
        ...covered_intervals.flatMap(r => r.spots),
        ...normalized_gaps.flatMap(g => g.spots),
    ]) {
        const key = spot.id;
        if (!seen.has(key)) {
            seen.add(key);
            deduped.push(spot);
        }
    }

    const tx = db.transaction(STORE_NAME, "readwrite");
    await Promise.all([
        ...covered_intervals.map(r => tx.store.delete(r.id)),
        tx.store.add({ start: merged_start, end: merged_end, spots: deduped }),
        tx.done,
    ]);

    return deduped;
}

export async function evict_old_records(db) {
    const cutoff = Date.now() - 5 * 86_400_000;
    const all_records = await db.getAll(STORE_NAME);
    const tx = db.transaction(STORE_NAME, "readwrite");

    for (const record of all_records) {
        const kept = record.spots.filter(s => s.time * 1000 >= cutoff);
        if (kept.length === 0) {
            tx.store.delete(record.id);
        } else if (kept.length !== record.spots.length) {
            tx.store.put({
                ...record,
                start: Math.max(record.start, cutoff),
                spots: kept,
            });
        }
    }

    await tx.done;
}

export function open_db_and_evict() {
    return open_db()
        .then(db => evict_old_records(db))
        .catch(() => {});
}

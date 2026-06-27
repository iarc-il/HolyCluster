import { continents, modes } from "@/data/filters_data.js";
import { normalize_spot_dxcc_fields } from "@/utils/spot_dxcc.js";
import { openDB } from "idb";

const DB_NAME = "holycluster_spot_cache";
const DB_VERSION = 1;
const STORE_NAME = "intervals";

let db_promise = null;

export function open_db() {
    if (!db_promise) {
        db_promise = openDB(DB_NAME, DB_VERSION, {
            upgrade(db) {
                const store = db.createObjectStore(STORE_NAME, {
                    keyPath: "id",
                    autoIncrement: true,
                });
                store.createIndex("idx_start", "start");
                store.createIndex("idx_end", "end");
            },
            blocked() {
                db_promise = null;
            },
        });
    }
    return db_promise;
}

export async function find_overlapping_intervals(db, start_ms, end_ms) {
    const candidates = await db.getAllFromIndex(
        STORE_NAME,
        "idx_start",
        IDBKeyRange.upperBound(end_ms),
    );
    return candidates.filter(r => r.end >= start_ms).sort((a, b) => a.start - b.start);
}

export function compute_gaps(start_ms, end_ms, covered_intervals) {
    const gaps = [];
    let cursor = start_ms;
    for (const interval of covered_intervals) {
        if (interval.start > cursor) {
            gaps.push({ start: cursor, end: interval.start });
        }
        cursor = Math.max(cursor, interval.end);
        if (cursor >= end_ms) break;
    }
    if (cursor < end_ms) {
        gaps.push({ start: cursor, end: end_ms });
    }
    return gaps;
}

export async function fetch_window(start_unix, end_unix, signal) {
    const res = await fetch(`/history?start_time=${start_unix}&end_time=${end_unix}`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.spots;
}

export async function fetch_gaps(gaps, signal) {
    return Promise.all(
        gaps.map(async gap => ({
            start: gap.start,
            end: gap.end,
            raw_spots: await fetch_window(
                Math.floor(gap.start / 1000),
                Math.floor(gap.end / 1000),
                signal,
            ),
        })),
    );
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

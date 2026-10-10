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

const store = create_interval_db(DB_NAME, DB_VERSION, STORE_NAME);

export const subscribe = store.subscribe;
export const get_version = store.get_version;

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

// Pure sync read: whatever spots are currently known for [start_ms, end_ms],
// plus whether that range is fully covered. Safe to call during render.
export function get_spots(start_ms, end_ms) {
    const covered = store.get_overlapping_intervals(start_ms, end_ms);
    const gaps = compute_gaps(start_ms, end_ms, covered);
    // Overlapping records can (briefly, or if eviction/commit timing lines
    // up unluckily) both hold the same spot — dedupe by id so a query
    // spanning two such records never returns it twice.
    const seen = new Set();
    const spots = [];
    for (const spot of covered.flatMap(r => r.spots)) {
        if (spot.time * 1000 < start_ms || spot.time * 1000 > end_ms) continue;
        if (seen.has(spot.id)) continue;
        seen.add(spot.id);
        spots.push(spot);
    }
    return { spots, is_complete: gaps.length === 0 };
}

async function fetch_gaps(send, subscribe_ws, wait_for_open, gaps, signal) {
    const results = await fetch_gaps_generic(
        send,
        subscribe_ws,
        wait_for_open,
        "spots",
        gaps,
        signal,
        data => data.spots.spots,
    );
    return results.map(r => ({ start: r.start, end: r.end, raw_spots: r.payload }));
}

// Background-only: fetches whatever's missing for [start_ms, end_ms] and
// merges it in. No-ops (no network call at all) if already fully covered.
// Never call this from a render — it's only ever invoked from an effect.
export async function ensure_spots_loaded(
    send,
    subscribe_ws,
    wait_for_open,
    start_ms,
    end_ms,
    signal,
) {
    await store.ready();

    const initial_covered = store.get_overlapping_intervals(start_ms, end_ms);
    const gaps = compute_gaps(start_ms, end_ms, initial_covered);
    if (gaps.length === 0) return;

    const gap_results = await fetch_gaps(send, subscribe_ws, wait_for_open, gaps, signal);
    const normalized_gaps = gap_results.map(g => ({
        start: g.start,
        end: g.end,
        spots: normalize_spots(g.raw_spots),
    }));

    // Re-read covered intervals now, inside the write lock, instead of
    // reusing the snapshot from before the (slow) network fetch — a
    // concurrent prefetch chain for an overlapping range may have committed
    // in the meantime. Committing against a stale snapshot would leave two
    // overlapping records behind, each holding the same spots.
    await store.with_lock(async () => {
        const covered = store.get_overlapping_intervals(start_ms, end_ms);
        const merged_start = Math.min(
            start_ms,
            ...covered.map(r => r.start),
            ...normalized_gaps.map(g => g.start),
        );
        const merged_end = Math.max(
            end_ms,
            ...covered.map(r => r.end),
            ...normalized_gaps.map(g => g.end),
        );

        const seen = new Set();
        const deduped = [];
        for (const spot of [
            ...covered.flatMap(r => r.spots),
            ...normalized_gaps.flatMap(g => g.spots),
        ]) {
            if (!seen.has(spot.id)) {
                seen.add(spot.id);
                deduped.push(spot);
            }
        }

        await store.commit(covered, { start: merged_start, end: merged_end, spots: deduped });
    });
}

export async function evict_old_records() {
    const cutoff = Date.now() - 5 * 86_400_000;
    await store.evict(cutoff, (record, cutoff_ms) => {
        const kept = record.spots.filter(s => s.time * 1000 >= cutoff_ms);
        if (kept.length === 0) return null;
        if (kept.length === record.spots.length) return record;
        return { ...record, start: Math.max(record.start, cutoff_ms), spots: kept };
    });
}

export function open_db_and_evict() {
    return evict_old_records().catch(() => {});
}

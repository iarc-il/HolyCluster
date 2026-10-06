import { is_canada_dxcc_code, is_us_state_dxcc_code } from "@/data/dxcc_entities.js";
import { continents, modes } from "@/data/filters_data.js";
import { read_live_spot_snapshot, write_live_spot_snapshot } from "@/utils/live_spot_snapshot.js";
import { normalize_spot_dxcc_fields } from "@/utils/spot_dxcc.js";
import { find_zone_number } from "@/utils/zones.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { ReadyState, useWs, useWsMessage } from "./useWs";

export function normalize_band(band) {
    if (band === 2) return "VHF";
    if (band === 0.7) return "UHF";
    if (band < 1) return "SHF";
    return band;
}

export function has_valid_enriched_value(value) {
    return value !== undefined && value !== null && value !== "" && value !== -1 && value !== "-1";
}

export function enrich_spot_zones_if_missing(spot) {
    const updates = {};

    if (!has_valid_enriched_value(spot.dx_cq_zone)) {
        updates.dx_cq_zone = find_zone_number("cq", spot.dx_loc);
    }
    if (!has_valid_enriched_value(spot.dx_itu_zone)) {
        updates.dx_itu_zone = find_zone_number("itu", spot.dx_loc);
    }
    if (!has_valid_enriched_value(spot.spotter_cq_zone)) {
        updates.spotter_cq_zone = find_zone_number("cq", spot.spotter_loc);
    }
    if (!has_valid_enriched_value(spot.spotter_itu_zone)) {
        updates.spotter_itu_zone = find_zone_number("itu", spot.spotter_loc);
    }

    if (!has_valid_enriched_value(spot.dx_state)) {
        if (is_us_state_dxcc_code(spot.dx_dxcc_code)) {
            updates.dx_state = find_zone_number("us_state", spot.dx_loc);
        } else if (is_canada_dxcc_code(spot.dx_dxcc_code)) {
            updates.dx_state = find_zone_number("ca_province", spot.dx_loc);
        }
    }

    if (!has_valid_enriched_value(spot.spotter_state)) {
        if (is_us_state_dxcc_code(spot.spotter_dxcc_code)) {
            updates.spotter_state = find_zone_number("us_state", spot.spotter_loc);
        } else if (is_canada_dxcc_code(spot.spotter_dxcc_code)) {
            updates.spotter_state = find_zone_number("ca_province", spot.spotter_loc);
        }
    }

    return Object.keys(updates).length > 0 ? { ...spot, ...updates } : spot;
}

export function trim_spots_to_last_hour(spots) {
    const current_time = Date.now() / 1000;
    return spots.filter(
        spot =>
            Number.isFinite(spot.time) &&
            spot.time > current_time - 3600 &&
            spot.time <= current_time + 60,
    );
}

export function flatten_buffered_spot_batches(spot_batches) {
    return [...spot_batches].reverse().flat();
}

export default function useSpotWebSocket() {
    const { send, network_state, readyState } = useWs();
    const [raw_spots, set_spots] = useState(read_live_spot_snapshot);
    const [new_spot_ids, set_new_spot_ids] = useState(new Set());
    const cached_ids_ref = useRef(new Set(raw_spots.map(spot => spot.id)));

    const started_ref = useRef(false);
    const last_spot_time_ref = useRef(0);
    const is_buffering_spots_ref = useRef(false);
    const buffered_spot_batches_ref = useRef([]);

    const track_latest_spot_time = useCallback(spots => {
        if (spots.length === 0) return;

        last_spot_time_ref.current = Math.max(
            last_spot_time_ref.current,
            ...spots.map(spot => spot.time),
        );
    }, []);

    const apply_spot_update = useCallback(
        new_spots => {
            const new_ids = new Set(new_spots.map(spot => spot.id));
            set_new_spot_ids(new_ids);

            setTimeout(() => {
                set_new_spot_ids(new Set());
            }, 3000);

            set_spots(previous_spots => {
                // Drop any previously-known spot that the incoming batch also
                // describes (same content-derived id) before merging — a spot
                // can legitimately arrive twice (e.g. a reconnect catch-up
                // racing the live broadcast for the same spot) and without
                // this it would render as two rows.
                const deduped_previous = previous_spots.filter(spot => !new_ids.has(spot.id));
                const merged_spots = trim_spots_to_last_hour([...new_spots, ...deduped_previous]);
                track_latest_spot_time(merged_spots);

                return merged_spots;
            });
        },
        [track_latest_spot_time],
    );

    const release_buffered_spots = useCallback(() => {
        if (buffered_spot_batches_ref.current.length === 0) return;

        const buffered_spots = flatten_buffered_spot_batches(buffered_spot_batches_ref.current);
        buffered_spot_batches_ref.current = [];

        if (buffered_spots.length > 0) {
            apply_spot_update(buffered_spots);
        }
    }, [apply_spot_update]);

    const set_spot_buffering = useCallback(
        should_buffer_spots => {
            const was_buffering_spots = is_buffering_spots_ref.current;
            is_buffering_spots_ref.current = should_buffer_spots;

            if (was_buffering_spots && !should_buffer_spots) {
                release_buffered_spots();
            }
        },
        [release_buffered_spots],
    );

    useEffect(() => {
        const timer = setInterval(() => {
            const cached_ids = new Set(cached_ids_ref.current);
            const valid_cached_ids = cached_ids.size
                ? new Set(read_live_spot_snapshot().map(spot => spot.id))
                : null;
            set_spots(previous_spots => {
                const retained = trim_spots_to_last_hour(previous_spots).filter(
                    spot => !cached_ids.has(spot.id) || valid_cached_ids?.has(spot.id),
                );
                return retained.length === previous_spots.length ? previous_spots : retained;
            });
            if (valid_cached_ids) {
                cached_ids_ref.current = new Set(
                    [...cached_ids].filter(id => valid_cached_ids.has(id)),
                );
            }
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        if (readyState === ReadyState.OPEN && !started_ref.current) {
            started_ref.current = true;
            send("spots", { action: "initial" });
        }
    }, [readyState, send]);

    useEffect(() => {
        if (
            readyState === ReadyState.OPEN &&
            started_ref.current &&
            last_spot_time_ref.current > 0
        ) {
            send("spots", { action: "catch_up", last_time: last_spot_time_ref.current });
        }
    }, [readyState]);

    useWsMessage("spots", data => {
        if (!Array.isArray(data.spots) || !["initial", "update"].includes(data.event)) return;
        const observed_at = Date.now();
        let new_spots = data.spots
            .map(spot => {
                const mode = spot.mode === "DIGITAL" ? "DIGI" : spot.mode;
                const normalized_spot = {
                    ...spot,
                    id: `${spot.time}|${spot.spotter_callsign}|${spot.dx_callsign}`,
                    mode,
                    band: normalize_band(spot.band),
                };
                return enrich_spot_zones_if_missing(normalize_spot_dxcc_fields(normalized_spot));
            })
            .filter(spot => {
                if (!spot.dx_dxcc_code || !spot.spotter_dxcc_code) {
                    console.warn("Dropping spot with unknown DXCC code", spot);
                    return false;
                }
                if (!modes.includes(spot.mode)) {
                    console.warn(`Dropping spot with unknown mode: ${spot.mode}`, spot);
                    return false;
                }
                if (!continents.includes(spot.dx_continent)) {
                    console.warn(
                        `Dropping spot with unknown dx_continent: ${spot.dx_continent}`,
                        spot,
                    );
                    return false;
                }
                if (!continents.includes(spot.spotter_continent)) {
                    console.warn(
                        `Dropping spot with unknown spotter_continent: ${spot.spotter_continent}`,
                        spot,
                    );
                    return false;
                }
                return true;
            });

        new_spots = trim_spots_to_last_hour(new_spots);
        void write_live_spot_snapshot(new_spots, observed_at);
        for (const spot of new_spots) cached_ids_ref.current.delete(spot.id);

        if (data.event === "update") {
            if (is_buffering_spots_ref.current) {
                buffered_spot_batches_ref.current.push(new_spots);
                track_latest_spot_time(new_spots);
                return;
            }

            apply_spot_update(new_spots);
        } else {
            cached_ids_ref.current.clear();
            set_spots(new_spots);
            track_latest_spot_time(new_spots);
        }
    });

    return { raw_spots, new_spot_ids, network_state, set_spot_buffering };
}

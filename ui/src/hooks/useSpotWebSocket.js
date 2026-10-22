import { is_canada_dxcc_code, is_us_state_dxcc_code } from "@/data/dxcc_entities.js";
import { continents, modes } from "@/data/filters_data.js";
import { read_live_spot_snapshot, write_live_spot_snapshot } from "@/utils/live_spot_snapshot.js";
import { normalize_spot_dxcc_fields } from "@/utils/spot_dxcc.js";
import { find_zone_number } from "@/utils/zones.js";
import { addBreadcrumb } from "@sentry/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ReadyState, useWs } from "./useWs";

let next_subscription_id = 0;

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

export function merge_spot_batches(incoming, previous) {
    const spots = new Map();
    for (const spot of [...incoming, ...previous]) {
        if (!spots.has(spot.id)) spots.set(spot.id, spot);
    }
    return trim_spots_to_last_hour([...spots.values()]).sort((a, b) => b.time - a.time);
}

export default function useSpotWebSocket() {
    const { send_now, subscribe, spot_socket_epoch, transport, network_state, readyState } =
        useWs();
    const [raw_spots, set_spots] = useState(read_live_spot_snapshot);
    const [new_spot_ids, set_new_spot_ids] = useState(new Set());
    const cached_ids_ref = useRef(new Set(raw_spots.map(spot => spot.id)));

    const subscription_ref = useRef(null);
    const highlight_timer_ref = useRef(null);
    useEffect(() => () => clearTimeout(highlight_timer_ref.current), []);
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

            clearTimeout(highlight_timer_ref.current);
            highlight_timer_ref.current = setTimeout(() => {
                set_new_spot_ids(new Set());
            }, 3000);

            set_spots(previous_spots => {
                const merged_spots = merge_spot_batches(new_spots, previous_spots);
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

    const receive_spots = useCallback(
        data => {
            const pending = subscription_ref.current;
            if (data.event === "subscribed") {
                if (
                    pending?.active &&
                    data.subscription_ack === true &&
                    data.subscription_id === pending.request.subscription_id
                ) {
                    pending.acknowledged = true;
                    pending.cancel();
                }
                return;
            }
            if (!Array.isArray(data.spots) || !["initial", "update"].includes(data.event)) return;
            if (
                pending?.active &&
                data.subscription_id === undefined &&
                data.subscription_ack === undefined
            ) {
                // Old responses prove registration, not correlated catch-up completion.
                pending.delivered = true;
                pending.cancel();
            }
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
                    return enrich_spot_zones_if_missing(
                        normalize_spot_dxcc_fields(normalized_spot),
                    );
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
            const cached_ids = new Set(cached_ids_ref.current);
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
                set_spots(previous =>
                    merge_spot_batches(
                        previous.filter(spot => !cached_ids.has(spot.id)),
                        new_spots,
                    ),
                );
                track_latest_spot_time(new_spots);
            }
        },
        [apply_spot_update, track_latest_spot_time],
    );

    useEffect(() => {
        // The listener must exist before a synchronous response to send_now.
        const unsubscribe = subscribe("spots", receive_spots);
        if (readyState !== ReadyState.OPEN || spot_socket_epoch == null) {
            subscription_ref.current = null;
            return unsubscribe;
        }
        let pending = subscription_ref.current;
        if (pending?.epoch !== spot_socket_epoch || pending?.transport !== transport) {
            pending = {
                epoch: spot_socket_epoch,
                transport,
                request: {
                    ...(last_spot_time_ref.current > 0
                        ? { action: "catch_up", last_time: last_spot_time_ref.current }
                        : { action: "initial" }),
                    subscription_id: `${spot_socket_epoch}:${++next_subscription_id}`,
                },
                attempts: 0,
                acknowledged: false,
                delivered: false,
            };
            subscription_ref.current = pending;
        }
        let timer;
        pending.active = true;
        pending.cancel = () => clearTimeout(timer);
        const attempt = () => {
            if (!pending.active || pending.acknowledged || pending.delivered) return;
            const sent = send_now("spots", pending.request, pending.epoch);
            pending.attempts += 1;
            if ([1, 2, 5].includes(pending.attempts)) {
                addBreadcrumb({
                    category: "spots.subscription",
                    data: {
                        transport,
                        action: pending.request.action,
                        attempt: pending.attempts,
                        sent,
                        delivered: pending.delivered,
                    },
                });
            }
            if (!pending.active || pending.acknowledged || pending.delivered) return;
            const delay = Math.min(1000 * 2 ** Math.min(pending.attempts - 1, 5), 30000);
            timer = setTimeout(attempt, Math.min(30000, delay * (0.8 + Math.random() * 0.4)));
        };
        attempt();
        return () => {
            pending.active = false;
            pending.cancel();
            unsubscribe();
        };
    }, [readyState, spot_socket_epoch, transport, subscribe, send_now, receive_spots]);

    return { raw_spots, new_spot_ids, network_state, set_spot_buffering };
}

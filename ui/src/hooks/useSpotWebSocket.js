import { is_canada_dxcc_code, is_us_state_dxcc_code } from "@/data/dxcc_entities.js";
import { continents, modes } from "@/data/filters_data.js";
import { normalize_spot_dxcc_fields } from "@/utils/spot_dxcc.js";
import { find_zone_number } from "@/utils/zones.js";
import { useCallback, useEffect, useRef, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";

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
    const current_time = Math.round(Date.now() / 1000);
    return spots.filter(spot => spot.time > current_time - 3600);
}

export default function useSpotWebSocket() {
    const [raw_spots, set_spots] = useState([]);
    const [new_spot_ids, set_new_spot_ids] = useState(new Set());
    const [network_state, set_network_state] = useState("connecting");

    const [is_first_connection, set_is_first_connection] = useState(true);
    const last_spot_time_ref = useRef(0);
    const next_spot_id_ref = useRef(0);

    const { lastJsonMessage, readyState, sendJsonMessage, getWebSocket } = useWebSocket(
        "/spots_ws",
        {
            onOpen: () => {
                if (is_first_connection) {
                    sendJsonMessage({ initial: true });
                    set_is_first_connection(false);
                } else {
                    sendJsonMessage({ last_time: last_spot_time_ref.current });
                }
            },
            reconnectAttempts: Number.POSITIVE_INFINITY,
            reconnectInterval: attemptNumber => Math.min(5000 * 2 ** (attemptNumber - 1), 30000),
            shouldReconnect: () => true,
        },
    );

    useEffect(() => {
        if (lastJsonMessage) {
            const data = lastJsonMessage;
            let new_spots = data.spots
                .map(spot => {
                    const mode = spot.mode === "DIGITAL" ? "DIGI" : spot.mode;
                    const normalized_spot = {
                        ...spot,
                        id: next_spot_id_ref.current++,
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

            if (data.type === "update") {
                const new_ids = new Set(new_spots.map(spot => spot.id));
                set_new_spot_ids(new_ids);

                setTimeout(() => {
                    set_new_spot_ids(new Set());
                }, 3000);

                set_spots(previous_spots => {
                    const merged_spots = trim_spots_to_last_hour(new_spots.concat(previous_spots));

                    if (merged_spots.length > 0) {
                        last_spot_time_ref.current = Math.max(
                            ...merged_spots.map(spot => spot.time),
                        );
                    }

                    return merged_spots;
                });
            } else {
                new_spots = trim_spots_to_last_hour(new_spots);
                set_spots(new_spots);

                if (new_spots.length > 0) {
                    last_spot_time_ref.current = Math.max(...new_spots.map(spot => spot.time));
                }
            }
        }
    }, [lastJsonMessage]);

    useEffect(() => {
        switch (readyState) {
            case ReadyState.CONNECTING:
                set_network_state("connecting");
                break;
            case ReadyState.OPEN:
                set_network_state("connected");
                break;
            case ReadyState.CLOSED:
                set_network_state("disconnected");
                break;
        }
    }, [readyState]);

    return { raw_spots, new_spot_ids, network_state };
}

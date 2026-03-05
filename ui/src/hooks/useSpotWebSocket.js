import { useCallback, useEffect, useRef, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
import { modes, continents } from "@/data/filters_data.js";
import { shorten_dxcc } from "@/data/flags.js";

function normalize_band(band) {
    if (band == 2) return "VHF";
    if (band == 0.7) return "UHF";
    if (band < 1) return "SHF";
    return band;
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
            reconnectAttempts: Infinity,
            reconnectInterval: attemptNumber =>
                Math.min(5000 * Math.pow(2, attemptNumber - 1), 30000),
            shouldReconnect: () => true,
        },
    );

    useEffect(() => {
        if (lastJsonMessage) {
            const data = lastJsonMessage;
            let new_spots = data.spots
                .map(spot => {
                    spot.id = next_spot_id_ref.current++;
                    if (spot.mode === "DIGITAL") spot.mode = "DIGI";
                    spot.band = normalize_band(spot.band);
                    spot.dx_country = shorten_dxcc(spot.dx_country);
                    return spot;
                })
                .filter(spot => {
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

                new_spots = new_spots.concat(raw_spots);
            }

            let current_time = Math.round(Date.now() / 1000);
            new_spots = new_spots.filter(spot => spot.time > current_time - 3600);
            set_spots(new_spots);

            if (new_spots.length > 0) {
                last_spot_time_ref.current = Math.max(...new_spots.map(spot => spot.time));
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

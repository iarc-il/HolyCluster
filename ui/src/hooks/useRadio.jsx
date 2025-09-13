import useWebSocket, { ReadyState } from "react-use-websocket";
import { useState, useEffect, createContext, useContext } from "react";
import { useSettings } from "./useSettings";

const band_plans = {
    160: {
        min: 1800000,
        max: 2000000,
    },
    80: {
        min: 3500000,
        max: 4000000,
    },
    60: {
        min: 5351000,
        max: 5366000,
    },
    40: {
        min: 7000000,
        max: 7300000,
    },
    30: {
        min: 10100000,
        max: 10150000,
    },
    20: {
        min: 14000000,
        max: 14350000,
    },
    17: {
        min: 18068000,
        max: 18168000,
    },
    15: {
        min: 21000000,
        max: 21450000,
    },
    12: {
        min: 24890000,
        max: 24990000,
    },
    10: {
        min: 28000000,
        max: 29700000,
    },
    6: {
        min: 50000000,
        max: 52000000,
    },
    4: {
        min: 70000000,
        max: 70500000,
    },
};

const RadioContext = createContext(null);

export function RadioProvider({ children }) {
    const { settings } = useSettings();

    const host = window.location.host;
    const protocol = window.location.protocol;
    const websocket_url = (protocol == "https:" ? "wss:" : "ws:") + "//" + host + "/radio";

    const { sendJsonMessage, readyState, lastJsonMessage } = useWebSocket(websocket_url);
    const [radio_status, set_radio_status] = useState("unavailable");
    const [radio_freq, set_radio_freq] = useState(0);
    const [radio_mode, set_radio_mode] = useState("");
    const [rig, set_rig] = useState(1);
    const [radio_band, set_radio_band] = useState(-1);
    const [catserver_version, set_catserver_version] = useState(null);

    function get_band_from_freq(freq) {
        for (let band of Object.keys(band_plans)) {
            if (freq <= band_plans[band].max && freq >= band_plans[band].min) {
                return Number.parseInt(band);
            }
        }

        return -1;
    }

    useEffect(() => {
        if (lastJsonMessage != null) {
            if ("status" in lastJsonMessage) {
                if ("version" in lastJsonMessage) {
                    set_catserver_version(lastJsonMessage.version);
                }
                set_radio_status(lastJsonMessage.status);
                set_radio_freq(lastJsonMessage.freq);
                set_radio_mode(lastJsonMessage.mode);
                set_rig(lastJsonMessage.current_rig);
                set_radio_band(get_band_from_freq(lastJsonMessage.freq));
            }

            if ("focus" in lastJsonMessage && lastJsonMessage.focus) {
                window.focus();
            }

            if ("close" in lastJsonMessage && lastJsonMessage.close) {
                window.close();
            }
        }
    }, [lastJsonMessage]);

    function send_message_to_radio(message) {
        if (readyState == ReadyState.OPEN) {
            sendJsonMessage(message);
        }
    }

    function is_radio_available() {
        return readyState === ReadyState.OPEN && radio_status !== "unavailable";
    }

    function highlight_spot(spot, udp_port) {
        if (spot) {
            send_message_to_radio({
                type: "HighlightSpot",
                dx_callsign: spot.dx_callsign,
                de_callsign: settings.callsign,
                freq: Math.round(spot.freq * 1000),
                mode: spot.mode,
                udp_port,
            });
        }
    }

    return (
        <RadioContext.Provider
            value={{
                send_message_to_radio,
                highlight_spot,
                is_radio_available,
                radio_status,
                radio_freq,
                radio_mode,
                radio_band,
                catserver_version,
                rig,
            }}
        >
            {children}
        </RadioContext.Provider>
    );
}

export default function useRadio() {
    const context = useContext(RadioContext);
    return { ...context };
}

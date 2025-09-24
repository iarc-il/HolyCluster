import useWebSocket, { ReadyState } from "react-use-websocket";
import { useState, useEffect, createContext, useContext } from "react";
import { useSettings } from "./useSettings";
import { get_base_url } from "@/utils.js";

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
    VHF: {
        min: 144000000,
        max: 144300000,
    },
    UHF: {
        min: 432000000,
        max: 433000000,
    },
};

function parse_version(raw_version) {
    if (!raw_version) {
        return null;
    }

    const match = raw_version.match(/catserver-v(\d+)\.(\d+)\.(\d+)(-(\d+)-g[a-f0-9]+)?/);
    if (!match) {
        return [0, 0, 0, 0];
    }

    const [, major, minor, patch, _, commit] = match;
    return [
        parseInt(major, 10),
        parseInt(minor, 10),
        parseInt(patch, 10),
        commit ? parseInt(commit, 10) : 0,
    ];
}

export function useCatserverVersion(raw_local_version) {
    const [raw_remote_version, set_raw_remote_version] = useState(null);
    const [new_version_available, set_new_version_available] = useState(false);
    const [filename, set_filename] = useState("");

    const local_version = parse_version(raw_local_version);
    const remote_version = parse_version(raw_remote_version);

    useEffect(() => {
        if (raw_local_version == null) {
            return;
        }

        fetch(get_base_url() + "/catserver/latest")
            .then(data => data.text())
            .then(data => {
                set_filename(data);
                const raw_remote_version = data.slice(0, data.lastIndexOf("."));
                set_raw_remote_version(raw_remote_version);

                if (local_version > parse_version(raw_remote_version)) {
                    set_new_version_available(true);
                    console.log(
                        `New version available - Remote: ${raw_remote_version}, Local: ${local_version}`,
                    );
                }
            });
    }, [raw_local_version]);

    return {
        local_version,
        remote_version,
        raw_local_version,
        raw_remote_version,
        new_version_available,
        filename,
    };
}

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
    const [rig, set_rig_inner] = useState(1);
    const [radio_band, set_radio_band] = useState(-1);
    const [raw_local_version, set_raw_local_version] = useState(null);

    function get_band_from_freq(freq) {
        for (let band of Object.keys(band_plans)) {
            if (freq <= band_plans[band].max && freq >= band_plans[band].min) {
                return band;
            }
        }

        return -1;
    }

    useEffect(() => {
        if (lastJsonMessage != null) {
            if ("status" in lastJsonMessage) {
                if ("version" in lastJsonMessage) {
                    set_raw_local_version(lastJsonMessage.version);
                }
                set_radio_status(lastJsonMessage.status);
                set_radio_freq(lastJsonMessage.freq);
                set_radio_mode(lastJsonMessage.mode);
                set_rig_inner(lastJsonMessage.current_rig);
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

    const version_data = useCatserverVersion(raw_local_version);

    const tagged_api_version = [1, 1, 0, 0];

    function highlight_spot(spot, udp_port) {
        if (spot && version_data.local_version > tagged_api_version) {
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

    function set_rig(rig) {
        if (![1, 2].includes(rig)) {
            return;
        }

        if (version_data.local_version > tagged_api_version) {
            send_message_to_radio({
                type: "SetRig",
                rig: rig,
            });
        } else {
            send_message_to_radio({
                rig: rig,
            });
        }
    }

    function set_mode_and_freq(mode, freq) {
        if (version_data.local_version > tagged_api_version) {
            send_message_to_radio({
                type: "SetModeAndFreq",
                mode,
                freq,
            });
        } else {
            send_message_to_radio({
                mode,
                freq,
            });
        }
    }

    return (
        <RadioContext.Provider
            value={{
                set_rig,
                set_mode_and_freq,
                highlight_spot,
                is_radio_available,
                radio_status,
                radio_freq,
                radio_mode,
                radio_band,
                raw_local_version,
                rig,
                ...version_data,
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

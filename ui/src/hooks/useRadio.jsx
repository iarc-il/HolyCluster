import { compare_version } from "@/utils.js";
import { createContext, useContext, useRef, useState } from "react";
import raw_band_plans from "../../../shared/band_plans.json";
import { useSettings } from "./useSettings";
import { useWs, useWsMessage } from "./useWs";

const band_plans = Object.fromEntries(
    Object.entries(raw_band_plans).map(([band, info]) => [
        band,
        { min: info.freq_start * 1000, max: info.freq_end * 1000 },
    ]),
);

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
        Number.parseInt(major, 10),
        Number.parseInt(minor, 10),
        Number.parseInt(patch, 10),
        commit ? Number.parseInt(commit, 10) : 0,
    ];
}

const RadioContext = createContext(null);

export function RadioProvider({ children }) {
    const [radio_status, set_radio_status] = useState("unavailable");
    const [radio_freq, set_radio_freq] = useState(0);
    const [radio_mode, set_radio_mode] = useState("");
    const [rig, set_rig_inner] = useState(1);
    const [radio_band, set_radio_band] = useState(-1);
    const [raw_local_version, set_raw_local_version] = useState(null);
    const { send } = useWs();
    const [radio_ready, set_radio_ready] = useState(false);
    const [radio_capabilities, set_radio_capabilities] = useState(null);
    const [hamlib_models, set_hamlib_models] = useState([]);
    const [hamlib_models_error, set_hamlib_models_error] = useState(null);
    const [serial_ports, set_serial_ports] = useState([]);
    const [serial_ports_error, set_serial_ports_error] = useState(null);
    const [hamlib_model_detail, set_hamlib_model_detail] = useState(null);
    const [hamlib_model_details, set_hamlib_model_details] = useState({});
    const [hamlib_model_error, set_hamlib_model_error] = useState(null);
    const [radio_configuration, set_radio_configuration_state] = useState(null);
    const [radio_configuration_result, set_radio_configuration_result] = useState(null);
    const [radio_connection_result, set_radio_connection_result] = useState(null);
    const [radio_retry_result, set_radio_retry_result] = useState(null);
    const requested_model_ids = useRef(new Set());
    const pending_configuration_action = useRef(null);

    const { settings } = useSettings();

    function get_band_from_freq(freq) {
        for (const band of Object.keys(band_plans)) {
            if (freq <= band_plans[band].max && freq >= band_plans[band].min) {
                return band;
            }
        }

        return -1;
    }

    useWsMessage("radio", data => {
        if (data.event === "status") {
            if (data.catserver_version) {
                set_raw_local_version(data.catserver_version);
            }
            set_radio_status(data.status);
            set_radio_freq(data.freq || 0);
            set_radio_mode(data.mode || "");
            set_rig_inner(data.current_rig || 1);
            set_radio_band(get_band_from_freq(data.freq || 0));
            set_radio_ready(true);
        }

        if (data.event === "capabilities") {
            set_radio_capabilities(data);
        }

        if (data.event === "hamlib_models") {
            set_hamlib_models(data.models || []);
            set_hamlib_models_error(data.error || null);
        }

        if (data.event === "serial_ports") {
            set_serial_ports(data.ports || []);
            set_serial_ports_error(data.error || null);
        }

        if (data.event === "hamlib_model" && requested_model_ids.current.has(data.model_id)) {
            set_hamlib_model_detail(data.descriptors || null);
            if (data.descriptors != null) {
                set_hamlib_model_details(current => ({
                    ...current,
                    [data.model_id]: data.descriptors,
                }));
            }
            set_hamlib_model_error(data.error || null);
        }

        if (data.event === "configuration") {
            set_radio_configuration_state(data);
        }

        if (data.event === "configuration_result") {
            const action = pending_configuration_action.current;
            if (action?.type === "retry") {
                set_radio_retry_result(data);
            } else {
                set_radio_configuration_result(data);
                if (action?.type === "apply" && data.ok) {
                    set_radio_configuration_state({
                        event: "configuration",
                        ...action.config,
                    });
                }
            }
            action?.resolve?.(data);
            pending_configuration_action.current = null;
        }

        if (data.event === "radio_connection_result") {
            set_radio_connection_result(data);
        }

        if (data.event === "retry") {
            set_radio_retry_result(data);
        }

        if (data.event === "focus" && data.focus) {
            window.focus();
        }

        if (data.event === "close" && data.close) {
            window.close();
        }
    });

    function send_message_to_radio(message) {
        send("radio", message);
    }

    function is_radio_available() {
        return radio_ready && radio_status !== "unavailable";
    }

    const local_version = parse_version(raw_local_version);

    const tagged_api_version = [1, 1, 0, 0];

    function highlight_spot(spot, udp_port) {
        if (spot && compare_version(local_version, tagged_api_version) > 0) {
            send_message_to_radio({
                action: "HighlightSpot",
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

        send_message_to_radio({
            action: "SetRig",
            rig: rig,
        });
    }

    function set_mode_and_freq(mode, freq) {
        send_message_to_radio({
            action: "SetModeAndFreq",
            mode,
            freq,
        });
    }

    function get_radio_capabilities() {
        send_message_to_radio({ action: "GetCapabilities" });
    }

    function list_hamlib_models() {
        set_hamlib_models_error(null);
        send_message_to_radio({ action: "ListHamlibModels" });
    }

    function list_serial_ports() {
        set_serial_ports_error(null);
        send_message_to_radio({ action: "ListSerialPorts" });
    }

    function describe_hamlib_model(model_id) {
        requested_model_ids.current.add(model_id);
        set_hamlib_model_detail(null);
        set_hamlib_model_error(null);
        send_message_to_radio({ action: "DescribeHamlibModel", model_id });
    }

    function get_radio_configuration() {
        set_radio_configuration_result(null);
        set_radio_connection_result(null);
        send_message_to_radio({ action: "GetRadioConfiguration" });
    }

    function set_radio_configuration(config) {
        return new Promise(resolve => {
            pending_configuration_action.current = { type: "apply", config, resolve };
            set_radio_configuration_result(null);
            set_radio_connection_result(null);
            send_message_to_radio({ action: "SetRadioConfiguration", configuration: config });
        });
    }

    function test_radio_connection(config) {
        set_radio_connection_result(null);
        set_radio_configuration_result(null);
        send_message_to_radio({ action: "TestRadioConnection", config });
    }

    function retry_radio() {
        pending_configuration_action.current = { type: "retry" };
        set_radio_retry_result(null);
        send_message_to_radio({ action: "RetryRadio" });
    }

    return (
        <RadioContext.Provider
            value={{
                set_rig,
                set_mode_and_freq,
                highlight_spot,
                get_radio_capabilities,
                list_hamlib_models,
                list_serial_ports,
                describe_hamlib_model,
                get_radio_configuration,
                set_radio_configuration,
                test_radio_connection,
                retry_radio,
                is_radio_available,
                radio_status,
                radio_freq,
                radio_mode,
                radio_band,
                raw_local_version,
                rig,
                radio_capabilities,
                hamlib_models,
                hamlib_models_error,
                serial_ports,
                serial_ports_error,
                hamlib_model_detail,
                hamlib_model_details,
                hamlib_model_error,
                radio_configuration,
                radio_configuration_result,
                radio_connection_result,
                radio_retry_result,
                local_version,
            }}
        >
            {children}
        </RadioContext.Provider>
    );
}

export default function useRadio() {
    return useContext(RadioContext);
}

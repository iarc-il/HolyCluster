import { compare_version } from "@/utils.js";
import { RTTY_TUNING_MIN_VERSION, supports_cat_feature } from "@/utils/cat_features.js";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import raw_band_plans from "../../../shared/band_plans.json";
import { useSettings } from "./useSettings";
import { ReadyState, useWs, useWsMessage } from "./useWs";

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
    const [radio_band, set_radio_band] = useState(-1);
    const [raw_local_version, set_raw_local_version] = useState(null);
    const { send, radioReadyState, transport } = useWs();
    const [radio_ready, set_radio_ready] = useState(false);
    const [radio_capabilities, set_radio_capabilities] = useState(null);
    const [radio_models, set_radio_models] = useState([]);
    const [radio_models_error, set_radio_models_error] = useState(null);
    const [serial_ports, set_serial_ports] = useState([]);
    const [serial_ports_error, set_serial_ports_error] = useState(null);
    const [radio_model_detail, set_radio_model_detail] = useState(null);
    const [radio_model_details, set_radio_model_details] = useState({});
    const [radio_model_error, set_radio_model_error] = useState(null);
    const [radio_configuration, set_radio_configuration_state] = useState(null);
    const [radio_configuration_result, set_radio_configuration_result] = useState(null);
    const [radio_connection_result, set_radio_connection_result] = useState(null);
    const [radio_retry_result, set_radio_retry_result] = useState(null);
    const requested_model_ids = useRef(new Set());
    const pending_configuration_action = useRef(null);
    const cat_identity_ref = useRef(null);
    const cat_connected_ref = useRef(false);

    const { settings } = useSettings();

    useEffect(() => {
        if (radioReadyState !== ReadyState.CONNECTING && radioReadyState !== ReadyState.CLOSED)
            return;

        cat_connected_ref.current = false;
        cat_identity_ref.current = null;
        set_radio_ready(false);
        set_radio_status("unavailable");
        set_raw_local_version(null);
        set_radio_capabilities(null);
    }, [radioReadyState]);

    useEffect(() => {
        if (transport === "unified" && radio_ready && radio_capabilities == null) {
            send("radio", { action: "GetCapabilities" });
        }
    }, [transport, radio_ready, radio_capabilities, send]);

    function get_band_from_freq(freq) {
        for (const band of Object.keys(band_plans)) {
            if (freq <= band_plans[band].max && freq >= band_plans[band].min) {
                const numeric_band = Number(band);
                return Number.isNaN(numeric_band) ? band : numeric_band;
            }
        }

        return -1;
    }

    useWsMessage("radio", data => {
        if (data.event === "status") {
            const identity_changed =
                data.catserver_version != null &&
                cat_identity_ref.current != null &&
                data.catserver_version !== cat_identity_ref.current;
            if (identity_changed || data.status === "unavailable") {
                set_radio_capabilities(null);
            }
            if (data.catserver_version) {
                cat_connected_ref.current = true;
                cat_identity_ref.current = data.catserver_version;
                set_raw_local_version(data.catserver_version);
            } else if (data.status === "unavailable") {
                cat_connected_ref.current = false;
            }
            set_radio_status(data.status);
            set_radio_freq(data.freq || 0);
            set_radio_mode(data.mode || "");
            set_radio_band(get_band_from_freq(data.freq || 0));
            set_radio_ready(true);
        }

        if (data.event === "capabilities" && cat_connected_ref.current) {
            set_radio_capabilities(data);
            if (data.radio_configuration_api === 2) {
                send_message_to_radio({ action: "GetRadioConfiguration" });
            }
        }

        if (data.event === "radio_models") {
            set_radio_models(data.models || []);
            set_radio_models_error(data.error || null);
        }

        if (data.event === "serial_ports") {
            set_serial_ports(data.ports || []);
            set_serial_ports_error(data.error || null);
        }

        if (data.event === "radio_model" && requested_model_ids.current.has(data.model_id)) {
            set_radio_model_detail(data.descriptors || null);
            if (data.descriptors != null) {
                set_radio_model_details(current => ({
                    ...current,
                    [data.model_id]: data.descriptors,
                }));
            }
            set_radio_model_error(data.error || null);
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
        return radio_ready && radio_configuration?.rig !== null && radio_status !== "unavailable";
    }

    function is_cat_available() {
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

    function set_mode_and_freq(mode, freq) {
        if (mode === "RTTY" && !supports_cat_feature(local_version, RTTY_TUNING_MIN_VERSION)) {
            return;
        }

        send_message_to_radio({
            action: "SetModeAndFreq",
            mode,
            freq,
        });
    }

    function list_radio_models() {
        set_radio_models_error(null);
        send_message_to_radio({ action: "ListRadioModels" });
    }

    function list_serial_ports() {
        set_serial_ports_error(null);
        send_message_to_radio({ action: "ListSerialPorts" });
    }

    function describe_radio_model(model_id) {
        requested_model_ids.current.add(model_id);
        set_radio_model_detail(null);
        set_radio_model_error(null);
        send_message_to_radio({ action: "DescribeRadioModel", model_id });
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

    const radio_configuration_support =
        transport === "probing"
            ? "probing"
            : transport === "cat_v1_2" ||
                (radio_capabilities != null && radio_capabilities.radio_configuration_api !== 2)
              ? "update_required"
              : radio_capabilities?.radio_configuration_api === 2
                ? "supported"
                : "probing";

    return (
        <RadioContext.Provider
            value={{
                set_mode_and_freq,
                highlight_spot,
                list_radio_models,
                list_serial_ports,
                describe_radio_model,
                get_radio_configuration,
                set_radio_configuration,
                test_radio_connection,
                retry_radio,
                is_radio_available,
                is_cat_available,
                radio_status: radio_configuration?.rig === null ? "unavailable" : radio_status,
                radio_freq,
                radio_mode,
                radio_band,
                raw_local_version,
                radio_capabilities,
                radio_configuration_support,
                radio_models,
                radio_models_error,
                serial_ports,
                serial_ports_error,
                radio_model_detail,
                radio_model_details,
                radio_model_error,
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

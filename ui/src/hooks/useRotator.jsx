import { ROTATOR_MIN_VERSION, supports_cat_feature } from "@/utils/cat_features.js";
import { createContext, useContext, useRef, useState } from "react";
import useRadio from "./useRadio";
import { useWs, useWsMessage } from "./useWs";

const RotatorContext = createContext(null);

function normalize_azimuth(azimuth) {
    return ((azimuth % 360) + 360) % 360;
}

function angular_distance(a, b) {
    const delta = Math.abs(normalize_azimuth(a) - normalize_azimuth(b));
    return Math.min(delta, 360 - delta);
}

export function RotatorProvider({ children }) {
    const { local_version } = useRadio();
    const rotator_supported = supports_cat_feature(local_version, ROTATOR_MIN_VERSION);
    const [rotator_status, set_rotator_status] = useState("unavailable");
    const [rotator_azimuth, set_rotator_azimuth] = useState(null);
    const [rotator_target_azimuth, set_rotator_target_azimuth] = useState(null);
    const [rotator_name, set_rotator_name] = useState("");
    const [rotator_ready, set_rotator_ready] = useState(false);
    const [rotator_models, set_rotator_models] = useState([]);
    const [rotator_models_error, set_rotator_models_error] = useState(null);
    const [rotator_model_details, set_rotator_model_details] = useState({});
    const [rotator_model_error, set_rotator_model_error] = useState(null);
    const [rotator_configuration, set_rotator_configuration] = useState(null);
    const [rotator_configuration_result, set_rotator_configuration_result] = useState(null);
    const [rotator_connection_result, set_rotator_connection_result] = useState(null);
    const pending_action = useRef(null);
    const { send } = useWs();

    useWsMessage("rotator", data => {
        if (data.event === "rotator_models") {
            set_rotator_models(data.models || []);
            set_rotator_models_error(data.error || null);
            return;
        }
        if (data.event === "rotator_model") {
            if (data.descriptors) {
                set_rotator_model_details(current => ({
                    ...current,
                    [data.model_id]: data.descriptors,
                }));
            }
            set_rotator_model_error(data.error || null);
            return;
        }
        if (data.event === "rotator_configuration") {
            set_rotator_configuration(data);
            return;
        }
        if (data.event === "rotator_configuration_result") {
            set_rotator_configuration_result(data);
            if (data.ok && pending_action.current?.configuration) {
                set_rotator_configuration(pending_action.current.configuration);
            }
            pending_action.current?.resolve?.(data);
            pending_action.current = null;
            return;
        }
        if (data.event === "rotator_connection_result") {
            set_rotator_connection_result(data);
            return;
        }
        if (data.event !== "status") {
            return;
        }

        const next_azimuth = data.azimuth ?? null;
        set_rotator_status(data.status || "unavailable");
        set_rotator_azimuth(next_azimuth);
        set_rotator_target_azimuth(target => {
            if (target == null || next_azimuth == null) {
                return target;
            }
            return angular_distance(next_azimuth, target) <= 5 ? null : target;
        });
        set_rotator_name(data.name || "");
        set_rotator_ready(true);
    });

    function set_azimuth(azimuth) {
        if (!rotator_supported) return;

        const next_azimuth = Number(azimuth);
        if (!Number.isFinite(next_azimuth)) {
            return;
        }

        const normalized_azimuth = normalize_azimuth(next_azimuth);
        set_rotator_target_azimuth(normalized_azimuth);
        send("rotator", {
            action: "SetAzimuth",
            azimuth: normalized_azimuth,
        });
    }

    function list_rotator_models() {
        if (!rotator_supported) return;

        set_rotator_models_error(null);
        send("rotator", { action: "ListRotatorModels" });
    }

    function describe_rotator_model(model_id) {
        if (!rotator_supported) return;

        set_rotator_model_error(null);
        send("rotator", { action: "DescribeRotatorModel", model_id });
    }

    function get_rotator_configuration() {
        if (!rotator_supported) return;

        set_rotator_configuration_result(null);
        set_rotator_connection_result(null);
        send("rotator", { action: "GetRotatorConfiguration" });
    }

    function apply_rotator_configuration(configuration) {
        if (!rotator_supported) return Promise.resolve({ ok: false });

        return new Promise(resolve => {
            pending_action.current = { configuration, resolve };
            set_rotator_configuration_result(null);
            set_rotator_connection_result(null);
            send("rotator", { action: "SetRotatorConfiguration", configuration });
        });
    }

    function test_rotator_connection(configuration) {
        if (!rotator_supported) return;

        set_rotator_connection_result(null);
        send("rotator", { action: "TestRotatorConnection", configuration });
    }

    function retry_rotator() {
        if (rotator_supported) send("rotator", { action: "RetryRotator" });
    }

    function is_rotator_available() {
        return (
            rotator_supported &&
            rotator_ready &&
            !["unavailable", "disconnected"].includes(rotator_status)
        );
    }

    return (
        <RotatorContext.Provider
            value={{
                set_azimuth,
                is_rotator_available,
                rotator_supported,
                rotator_status: rotator_supported ? rotator_status : "unavailable",
                rotator_azimuth: rotator_supported ? rotator_azimuth : null,
                rotator_target_azimuth: rotator_supported ? rotator_target_azimuth : null,
                rotator_name: rotator_supported ? rotator_name : "",
                rotator_models: rotator_supported ? rotator_models : [],
                rotator_models_error: rotator_supported ? rotator_models_error : null,
                rotator_model_details: rotator_supported ? rotator_model_details : {},
                rotator_model_error: rotator_supported ? rotator_model_error : null,
                rotator_configuration: rotator_supported ? rotator_configuration : null,
                rotator_configuration_result: rotator_supported
                    ? rotator_configuration_result
                    : null,
                rotator_connection_result: rotator_supported ? rotator_connection_result : null,
                list_rotator_models,
                describe_rotator_model,
                get_rotator_configuration,
                apply_rotator_configuration,
                test_rotator_connection,
                retry_rotator,
            }}
        >
            {children}
        </RotatorContext.Provider>
    );
}

export default function useRotator() {
    return useContext(RotatorContext);
}

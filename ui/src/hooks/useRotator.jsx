import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useColors } from "./useColors";
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
    const { dev_mode } = useColors();
    const [rotator_status, set_rotator_status] = useState("unavailable");
    const [rotator_azimuth, set_rotator_azimuth] = useState(null);
    const [rotator_target_azimuth, set_rotator_target_azimuth] = useState(null);
    const [rotator_name, set_rotator_name] = useState("");
    const [rotator_ready, set_rotator_ready] = useState(false);
    const [rotator_models, set_rotator_models] = useState([]);
    const [rotator_model_details, set_rotator_model_details] = useState({});
    const [rotator_configuration, set_rotator_configuration] = useState(null);
    const [rotator_configuration_result, set_rotator_configuration_result] = useState(null);
    const [rotator_connection_result, set_rotator_connection_result] = useState(null);
    const pending_action = useRef(null);
    const { send } = useWs();

    useWsMessage("rotator", data => {
        if (data.event === "rotator_models") {
            set_rotator_models(data.models || []);
            return;
        }
        if (data.event === "rotator_model") {
            if (data.descriptors) {
                set_rotator_model_details(current => ({
                    ...current,
                    [data.model_id]: data.descriptors,
                }));
            }
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
        if (!dev_mode || data.event !== "status") {
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

    useEffect(() => {
        if (dev_mode) return;

        set_rotator_status("unavailable");
        set_rotator_azimuth(null);
        set_rotator_target_azimuth(null);
        set_rotator_name("");
        set_rotator_ready(false);
    }, [dev_mode]);

    function set_azimuth(azimuth) {
        if (!dev_mode) {
            return;
        }

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
        send("rotator", { action: "ListRotatorModels" });
    }

    function describe_rotator_model(model_id) {
        send("rotator", { action: "DescribeRotatorModel", model_id });
    }

    function get_rotator_configuration() {
        set_rotator_configuration_result(null);
        set_rotator_connection_result(null);
        send("rotator", { action: "GetRotatorConfiguration" });
    }

    function apply_rotator_configuration(configuration) {
        return new Promise(resolve => {
            pending_action.current = { configuration, resolve };
            set_rotator_configuration_result(null);
            set_rotator_connection_result(null);
            send("rotator", { action: "SetRotatorConfiguration", configuration });
        });
    }

    function test_rotator_connection(configuration) {
        set_rotator_connection_result(null);
        send("rotator", { action: "TestRotatorConnection", configuration });
    }

    function retry_rotator() {
        send("rotator", { action: "RetryRotator" });
    }

    function is_rotator_available() {
        return (
            dev_mode && rotator_ready && !["unavailable", "disconnected"].includes(rotator_status)
        );
    }

    return (
        <RotatorContext.Provider
            value={{
                set_azimuth,
                is_rotator_available,
                rotator_status,
                rotator_azimuth,
                rotator_target_azimuth,
                rotator_name,
                rotator_models,
                rotator_model_details,
                rotator_configuration,
                rotator_configuration_result,
                rotator_connection_result,
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

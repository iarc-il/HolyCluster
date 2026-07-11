import { createContext, useContext, useState } from "react";
import { useWs, useWsMessage } from "./useWs";

const RotatorContext = createContext(null);

function normalize_azimuth(azimuth) {
    return ((azimuth % 360) + 360) % 360;
}

export function RotatorProvider({ children }) {
    const [rotator_status, set_rotator_status] = useState("unavailable");
    const [rotator_azimuth, set_rotator_azimuth] = useState(null);
    const [rotator_name, set_rotator_name] = useState("");
    const [rotator_ready, set_rotator_ready] = useState(false);
    const { send } = useWs();

    useWsMessage("rotator", data => {
        if (data.event !== "status") {
            return;
        }

        set_rotator_status(data.status || "unavailable");
        set_rotator_azimuth(data.azimuth ?? null);
        set_rotator_name(data.name || "");
        set_rotator_ready(true);
    });

    function set_azimuth(azimuth) {
        const next_azimuth = Number(azimuth);
        if (!Number.isFinite(next_azimuth)) {
            return;
        }

        send("rotator", {
            action: "SetAzimuth",
            azimuth: normalize_azimuth(next_azimuth),
        });
    }

    function is_rotator_available() {
        return rotator_ready && !["unavailable", "disconnected"].includes(rotator_status);
    }

    return (
        <RotatorContext.Provider
            value={{
                set_azimuth,
                is_rotator_available,
                rotator_status,
                rotator_azimuth,
                rotator_name,
            }}
        >
            {children}
        </RotatorContext.Provider>
    );
}

export default function useRotator() {
    return useContext(RotatorContext);
}

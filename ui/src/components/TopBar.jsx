import SubmitSpot from "@/components/SubmitSpot.jsx";
import Clock from "@/components/Clock.jsx";
import NetworkState from "@/components/NetworkState.jsx";
import Spinner from "@/components/Spinner.jsx";
import Settings from "@/components/Settings.jsx";
import ColorPicker from "@/components/ColorPicker.jsx";
import Select from "@/components/Select.jsx";
import SevenSegmentDisplay from "@/components/SevenSegmentDisplay.jsx";
import { useColors } from "../hooks/useColors";
import { useFilters } from "../hooks/useFilters";
import { useLocalStorage } from "@uidotdev/usehooks";

import Icon from "@/icon.png";
import OpenMenu from "@/components/OpenMenu.jsx";

import { modes } from "@/filters_data.js";
import { useEffect } from "react";

const spots_time_limits = {
    "5 Minutes": 300,
    "15 Minutes": 900,
    "30 Minutes": 1800,
    "1 Hour": 3600,
    // "3 Hour": 10800,
    // "9 Hour": 32400,
    // "12 Hour": 43200,
    // "24 Hour": 86400,
};

function TopBar({
    settings,
    set_settings,
    set_map_controls,
    set_radius_in_km,
    network_state,
    toggled_ui,
    set_toggled_ui,
    dev_mode,
    radio_freq,
    radio_status,
    rig,
    set_rig,
}) {
    const { filters, setFilters } = useFilters();
    const box_container_style = "flex items-center h-full p-2 gap-3";

    const network_state_colors = {
        connected: "#00EE00",
        disconnected: "#EE0000",
    };
    const { colors } = useColors();
    const [requested_rig, set_requested_rig] = useLocalStorage("requested_rig", 1);

    useEffect(() => {
        if (rig && rig != requested_rig) {
            set_rig(requested_rig);
        }
    }, [rig]);

    return (
        <div
            className="flex flex-row justify-between items-center min-h-16 border-b-2"
            style={{
                backgroundColor: colors.theme.background,
                borderColor: colors.theme.borders,
            }}
        >
            <div className="p-2 hidden max-2xl:block">
                <OpenMenu
                    size="32"
                    on_click={() =>
                        set_toggled_ui({
                            ...toggled_ui,
                            left: !toggled_ui.left,
                        })
                    }
                />
            </div>
            <div className="hidden xs:flex h-full p-2 gap-3">
                <img className="object-contain max-h-12 w-10 m-auto" src={Icon} />
            </div>
            <h1
                className="hidden md:block text-3xl lg:text-4xl m-auto font-bold"
                style={{ color: colors.theme.text }}
            >
                The Holy Cluster
            </h1>

            {radio_status !== "unavailable" && radio_status !== "unknown" && (
                <>
                    <div className="flex flex-col w-[42px] h-full items-center ml-2 mr-1">
                        {[1, 2].map(rig_val => {
                            const rig_active = rig == rig_val;
                            return (
                                <p
                                    className={`text-right text-xs px-1 w-full rounded-sm hover:cursor-pointer py-[1px] ${
                                        rig_active ? "bg-red-400" : "hover:bg-gray-400"
                                    }`}
                                    style={{color: colors.theme.text}}
                                    onClick={() => {
                                        if (!rig_active) {
                                            set_requested_rig(rig_val);
                                            set_rig(rig_val);
                                        }
                                    }}
                                >
                                    Rig {rig_val}
                                </p>
                            );
                        })}
                    </div>

                    <div className="mr-5 h-full hidden lg:block">
                        <SevenSegmentDisplay
                            className={"h-[25px]"}
                            height={25}
                            display_size={radio_freq ? radio_freq.toString().length : 8}
                            value={radio_freq ? radio_freq : undefined}
                            error={radio_status !== "connected"}
                        />
                    </div>
                </>
            )}

            <div className={box_container_style}>
                <SubmitSpot settings={settings} />
                <Clock />

                <Select
                    value={filters.time_limit}
                    onChange={event =>
                        setFilters(state => ({
                            ...state,
                            time_limit: event.target.value,
                        }))
                    }
                >
                    {Object.entries(spots_time_limits).map(([text, minutes]) => {
                        return (
                            <option key={minutes} value={minutes}>
                                {text}
                            </option>
                        );
                    })}
                </Select>

                {network_state == "connecting" ? (
                    <Spinner size="32" color="lightblue" />
                ) : (
                    <span title={network_state}>
                        <NetworkState
                            size="40"
                            color={network_state_colors[network_state]}
                            title={network_state}
                        />
                    </span>
                )}
                <Settings
                    settings={settings}
                    set_settings={set_settings}
                    set_map_controls={set_map_controls}
                    set_radius_in_km={set_radius_in_km}
                    dev_mode={dev_mode}
                />
                {dev_mode ? <ColorPicker></ColorPicker> : ""}
                <div className="p-2 hidden max-2xl:block">
                    <OpenMenu
                        size="32"
                        on_click={() =>
                            set_toggled_ui({
                                ...toggled_ui,
                                right: !toggled_ui.right,
                            })
                        }
                    />
                </div>
            </div>
        </div>
    );
}

export default TopBar;

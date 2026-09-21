import Clock from "@/components/Clock.jsx";
import NetworkState from "@/components/NetworkState.jsx";
import SevenSegmentDisplay from "@/components/SevenSegmentDisplay.jsx";
import SubmitSpot from "@/components/SubmitSpot.jsx";
import { Settings } from "@/components/settings/Settings.jsx";
import Button from "@/components/ui/Button.jsx";
import ColorPicker from "@/components/ui/ColorPicker.jsx";
import Select from "@/components/ui/Select.jsx";
import Spinner from "@/components/ui/Spinner.jsx";
import { useColors } from "@/hooks/useColors";
import { useFilters } from "@/hooks/useFilters";
import { useProfiles } from "@/hooks/useProfiles.jsx";
import { useSpotData } from "@/hooks/useSpotData";
import { useMediaQuery } from "@uidotdev/usehooks";

import Icon from "@/assets/icon.png";
import OpenMenu from "@/components/OpenMenu.jsx";
import RotatorState from "@/components/RotatorState.jsx";

import use_radio from "@/hooks/useRadio";
import useRotator from "@/hooks/useRotator";
import { useEffect } from "react";

const spots_time_limits = {
    "5 Minutes": 300,
    "15 Minutes": 900,
    "30 Minutes": 1800,
    "1 Hour": 3600,
};

function TopBar({
    set_map_controls,
    set_radius_in_km,
    toggled_ui,
    set_toggled_ui,
    dev_mode,
    can_undo_cat,
    undo_cat,
}) {
    const { filters, setFilters } = useFilters();
    const { network_state } = useSpotData();
    const { radio_status } = use_radio();
    const { rotator_status, rotator_name, rotator_azimuth } = useRotator();
    const { profiles, active_profile_name, set_active_profile_name } = useProfiles();

    const network_state_colors = {
        connected: "#00EE00",
        disconnected: "#EE0000",
    };
    const { colors } = useColors();

    const { radio_freq } = use_radio();

    // Reset the toggle state when resizing the screen
    const is_max_2xl_device = useMediaQuery("only screen and (max-width : 96rem)");
    useEffect(() => {
        if (is_max_2xl_device) {
            set_toggled_ui({ left_visible: false, right_visible: false });
        } else {
            set_toggled_ui({ left_visible: true, right_visible: true });
        }
    }, [is_max_2xl_device]);

    return (
        <div
            className="flex flex-row z-[60] justify-between items-center h-[4rem] border-b-2"
            data-tour="top-bar"
            style={{
                backgroundColor: colors.theme.background,
                borderColor: colors.theme.borders,
            }}
        >
            <div className="p-2 hidden max-2xl:block" data-tour="top-bar-left-menu">
                <OpenMenu
                    size="32"
                    on_click={() =>
                        set_toggled_ui({
                            ...toggled_ui,
                            left_visible: !toggled_ui.left_visible,
                        })
                    }
                />
            </div>
            <div className="hidden xs:flex h-full p-2 gap-3" data-tour="top-bar-logo">
                <img
                    className="object-contain max-h-12 w-10 m-auto"
                    src={Icon}
                    alt="Holy Cluster logo"
                />
            </div>
            <h1
                className="hidden lg:block md:text-2xl text-4xl m-auto w-fit font-bold"
                data-tour="top-bar-title"
                style={{ color: colors.theme.text }}
            >
                The Holy Cluster
            </h1>

            <div className="flex items-center h-full p-2 gap-3">
                {radio_status !== "unavailable" && can_undo_cat && (
                    <Button
                        color="utility"
                        className="p-1"
                        data-tour="top-bar-cat-undo"
                        type="button"
                        aria-label="Undo CAT change"
                        title="Undo CAT change"
                        on_click={undo_cat}
                    >
                        <svg
                            fill="currentColor"
                            width="24"
                            height="24"
                            viewBox="0 0 512 512"
                            aria-hidden="true"
                        >
                            <path d="M255.545 8c-66.269.119-126.438 26.233-170.86 68.685L48.971 40.971C33.851 25.851 8 36.559 8 57.941V192c0 13.255 10.745 24 24 24h134.059c21.382 0 32.09-25.851 16.971-40.971l-41.75-41.75c30.864-28.899 70.801-44.907 113.23-45.273 92.398-.798 170.283 73.977 169.484 169.442C423.236 348.009 349.816 424 256 424c-41.127 0-79.997-14.678-110.63-41.556-4.743-4.161-11.906-3.908-16.368.553L89.34 422.659c-4.872 4.872-4.631 12.815.482 17.433C133.798 479.813 192.074 504 256 504c136.966 0 247.999-111.033 248-247.998C504.001 119.193 392.354 7.755 255.545 8z" />
                        </svg>
                    </Button>
                )}
                <RotatorState
                    status={rotator_status}
                    name={rotator_name}
                    azimuth={rotator_azimuth}
                />
                {radio_status !== "unavailable" ? (
                    <>
                        <div data-tour="top-bar-radio-frequency">
                            <SevenSegmentDisplay
                                height="10"
                                display_size={radio_freq ? radio_freq.toString().length : 8}
                                value={radio_freq ? radio_freq : undefined}
                                error={radio_status !== "connected"}
                            />
                        </div>
                    </>
                ) : (
                    ""
                )}
                {profiles.length > 1 && (
                    <div className="hidden md:block" data-tour="top-bar-profile-selector">
                        <Select
                            value={active_profile_name}
                            onChange={event => set_active_profile_name(event.target.value)}
                            className="w-28"
                        >
                            {profiles.map(profile => (
                                <option key={profile.name} value={profile.name}>
                                    {profile.name}
                                </option>
                            ))}
                        </Select>
                    </div>
                )}
                <SubmitSpot dev_mode={dev_mode} />
                <Clock />

                <Select
                    data-tour="top-bar-time-limit"
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

                <div className="hidden xs:block" data-tour="top-bar-network-state">
                    {network_state === "connecting" ? (
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
                </div>
                <Settings set_map_controls={set_map_controls} set_radius_in_km={set_radius_in_km} />
                {dev_mode ? <ColorPicker /> : ""}
                <div className="p-2 hidden max-2xl:block" data-tour="top-bar-right-menu">
                    <OpenMenu
                        size="32"
                        on_click={() =>
                            set_toggled_ui({
                                ...toggled_ui,
                                right_visible: !toggled_ui.right_visible,
                            })
                        }
                    />
                </div>
            </div>
        </div>
    );
}

export default TopBar;

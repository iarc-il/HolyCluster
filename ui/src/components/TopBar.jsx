import Clock from "@/components/Clock.jsx";
import InstallApp from "@/components/InstallApp.jsx";
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

import Icon from "@/assets/icon.png";
import RotatorState from "@/components/RotatorState.jsx";

import use_radio from "@/hooks/useRadio";
import useRotator from "@/hooks/useRotator";

const spots_time_limits = {
    "5 Minutes": 300,
    "15 Minutes": 900,
    "30 Minutes": 1800,
    "1 Hour": 3600,
};

function PanelControl({ panel, label, open_panel, toggle_panel }) {
    const { colors } = useColors();
    const is_open = open_panel === panel;
    return (
        <button
            type="button"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center cursor-pointer rounded border px-2 py-2 text-sm font-semibold hover:brightness-125 focus-visible:outline focus-visible:outline-2"
            style={{ color: colors.theme.text, borderColor: colors.theme.borders }}
            aria-label={`${is_open ? "Close" : "Open"} ${label}`}
            aria-expanded={is_open}
            aria-controls={`${panel}-panel`}
            onClick={event => toggle_panel(panel, event.currentTarget)}
        >
            <span className="hidden md:inline">{label}</span>
            <svg
                className="md:hidden"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                {panel === "filters" ? (
                    <path d="M3 4h18l-7 8v7l-4 2v-9z" />
                ) : (
                    <>
                        <path d="M4 7h16M4 17h16" />
                        <rect x="7" y="4" width="4" height="6" rx="1" />
                        <rect x="14" y="14" width="4" height="6" rx="1" />
                    </>
                )}
            </svg>
        </button>
    );
}

function DesktopTopBar({
    set_map_controls,
    set_radius_in_km,
    is_compact,
    open_panel,
    toggle_panel,
    dev_mode,
    can_undo_cat,
    undo_cat,
}) {
    const { filters, setFilters } = useFilters();
    const { network_state } = useSpotData();
    const { radio_status } = use_radio();
    const {
        rotator_status,
        rotator_name,
        rotator_heading,
        rotator_target_azimuth,
        rotator_tuning_enabled,
        toggle_rotator_tuning,
    } = useRotator();
    const { profiles, active_profile_name, set_active_profile_name } = useProfiles();

    const network_state_colors = {
        connected: "#00EE00",
        disconnected: "#EE0000",
    };
    const { colors } = useColors();

    const { radio_freq } = use_radio();

    return (
        <div
            className="flex flex-row shrink-0 z-[60] justify-between items-center h-[4rem] border-b-2"
            data-tour="top-bar"
            style={{
                backgroundColor: colors.theme.background,
                borderColor: colors.theme.borders,
            }}
        >
            {is_compact && (
                <div className="p-1 md:p-2 shrink-0" data-tour="top-bar-left-menu">
                    <PanelControl
                        panel="filters"
                        label="Filters"
                        open_panel={open_panel}
                        toggle_panel={toggle_panel}
                    />
                </div>
            )}
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

            <div className="flex items-center h-full p-1 gap-1 md:p-2 md:gap-2 lg:gap-3">
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
                    azimuth={rotator_heading}
                    moving={rotator_target_azimuth != null}
                    tuning_enabled={rotator_tuning_enabled}
                    on_click={toggle_rotator_tuning}
                />
                {radio_status !== "unavailable" ? (
                    <div
                        data-tour="top-bar-radio-frequency"
                        className="shrink-0"
                        style={{ color: colors.theme.text }}
                    >
                        <div className="md:hidden max-w-24 text-xs leading-4">
                            <div>Radio {radio_status}</div>
                            {radio_status === "connected" && (
                                <div className="whitespace-nowrap font-semibold tabular-nums">
                                    {radio_freq
                                        ? `${Number((radio_freq / 1_000_000).toFixed(6))} MHz`
                                        : "Frequency unknown"}
                                </div>
                            )}
                        </div>
                        <div className="hidden md:block" data-tour="radio-full-frequency">
                            <SevenSegmentDisplay
                                height="10"
                                display_size={radio_freq ? radio_freq.toString().length : 8}
                                value={radio_freq ? radio_freq : undefined}
                                error={radio_status !== "connected"}
                            />
                        </div>
                    </div>
                ) : null}

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
                <InstallApp />
                <SubmitSpot dev_mode={dev_mode} />
                <div className={radio_status !== "unavailable" ? "hidden md:block" : ""}>
                    <Clock />
                </div>

                <Select
                    data-tour="top-bar-time-limit"
                    className={radio_status !== "unavailable" ? "max-md:w-20 max-md:px-1" : ""}
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
                {is_compact && (
                    <div className="md:p-2 shrink-0" data-tour="top-bar-right-menu">
                        <PanelControl
                            panel="tools"
                            label="Tools"
                            open_panel={open_panel}
                            toggle_panel={toggle_panel}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

function MobileTaskBar({ set_map_controls, set_radius_in_km, dev_mode, can_undo_cat, undo_cat }) {
    const { colors } = useColors();
    const { filters, setFilters } = useFilters();
    const { network_state } = useSpotData();
    const { radio_status, radio_freq } = use_radio();
    const {
        rotator_status,
        rotator_name,
        rotator_heading,
        rotator_target_azimuth,
        rotator_tuning_enabled,
        toggle_rotator_tuning,
    } = useRotator();
    return (
        <header
            data-tour="top-bar"
            className="flex flex-col shrink-0 z-[60] border-b px-2 py-1 gap-1"
            style={{
                backgroundColor: colors.theme.background,
                borderColor: colors.theme.borders,
                color: colors.theme.text,
            }}
        >
            <div className="flex items-center justify-between gap-2 min-w-0">
                <div data-tour="top-bar-network-state" className="shrink-0" title={network_state}>
                    {network_state === "connecting" ? (
                        <Spinner size="24" color="lightblue" />
                    ) : (
                        <NetworkState
                            size="24"
                            color={network_state === "connected" ? "#00EE00" : "#EE0000"}
                            title={network_state}
                        />
                    )}
                </div>
                <Select
                    data-tour="top-bar-time-limit"
                    aria-label="Spot window"
                    className="flex-1 min-w-0"
                    value={filters.time_limit}
                    onChange={event =>
                        setFilters(state => ({ ...state, time_limit: event.target.value }))
                    }
                >
                    {Object.entries(spots_time_limits).map(([label, value]) => (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    ))}
                </Select>
                <InstallApp />
                <SubmitSpot dev_mode={dev_mode} />
                <Settings set_map_controls={set_map_controls} set_radius_in_km={set_radius_in_km} />
            </div>
            {(radio_status !== "unavailable" ||
                (colors.rotator[rotator_status] && rotator_name !== "unconfigured")) && (
                <div className="flex items-center gap-2 min-w-0 text-xs">
                    {radio_status !== "unavailable" && (
                        <div
                            data-tour="top-bar-radio-frequency"
                            className="flex-1 min-w-0 flex flex-wrap gap-x-2 items-center"
                        >
                            <span>Radio {radio_status}</span>
                            {radio_status === "connected" && (
                                <strong className="tabular-nums">
                                    {radio_freq
                                        ? `${Number((radio_freq / 1_000_000).toFixed(6))} MHz`
                                        : "Frequency unknown"}
                                </strong>
                            )}
                        </div>
                    )}
                    {radio_status !== "unavailable" && can_undo_cat && (
                        <Button
                            color="utility"
                            className="min-h-11 min-w-11 p-1"
                            aria-label="Undo CAT change"
                            data-tour="top-bar-cat-undo"
                            on_click={undo_cat}
                        >
                            ↶
                        </Button>
                    )}
                    <RotatorState
                        status={rotator_status}
                        name={rotator_name}
                        azimuth={rotator_heading}
                        moving={rotator_target_azimuth != null}
                        tuning_enabled={rotator_tuning_enabled}
                        on_click={toggle_rotator_tuning}
                    />
                </div>
            )}
        </header>
    );
}

export default function TopBar(props) {
    return props.is_mobile ? <MobileTaskBar {...props} /> : <DesktopTopBar {...props} />;
}

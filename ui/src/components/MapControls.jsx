import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button.jsx";
import Radio from "@/components/ui/Radio.jsx";
import Night from "@/components/Night.jsx";
import PropagationBar from "@/components/PropagationBar.jsx";
import Popup from "@/components/ui/Popup.jsx";
import { useColors } from "@/hooks/useColors";
import { useRestData } from "@/hooks/useRestData";
import use_radio from "@/hooks/useRadio";
import { useSettings } from "@/hooks/useSettings";
import { useFilters } from "@/hooks/useFilters";
import Maidenhead from "maidenhead";

const EXCLUSIVE_OVERLAY_CONTROL_KEYS = ["show_dxcc_labels", "show_cq_zones", "show_itu_zones"];

function clear_exclusive_overlays(state) {
    EXCLUSIVE_OVERLAY_CONTROL_KEYS.forEach(control_key => {
        state[control_key] = false;
    });
}

function MapControls({
    map_controls,
    set_map_controls,
    set_radius_in_km,
    auto_toggle_radius,
    can_undo_cat,
    undo_cat,
    is_map_fullscreen,
    toggle_map_fullscreen,
    is_mobile,
    is_history_mode,
    toggle_history,
}) {
    const { colors } = useColors();
    const { propagation } = useRestData();
    const { radio_status } = use_radio();
    const { settings } = useSettings();
    const { filters, setFilters } = useFilters();
    const mode_button_ref = useRef(null);
    const controls_panel_ref = useRef(null);
    const [show_mode_popup, set_show_mode_popup] = useState(false);
    const [show_controls_panel, set_show_controls_panel] = useState(false);

    const zone_filters = filters.zone_filters ?? {};
    const disabled_by_system = zone_filters.disabled_by_system ?? {};
    const MAX_VISIBLE_DISABLED_ZONES = 8;
    const cq_zones_on = map_controls.show_cq_zones;
    const dxcc_labels_on = map_controls.show_dxcc_labels ?? false;
    const itu_zones_on = map_controls.show_itu_zones;
    const us_states_on = map_controls.show_us_states ?? false;
    const can_states_on = map_controls.show_can_states ?? false;
    const equator_on = map_controls.show_equator ?? false;

    const active_zone_systems = cq_zones_on
        ? ["cq"]
        : itu_zones_on
          ? ["itu"]
          : [...(us_states_on ? ["us_state"] : []), ...(can_states_on ? ["ca_province"] : [])];

    const zone_system_labels = {
        cq: "CQ",
        itu: "ITU",
        us_state: "US",
        ca_province: "CA",
    };

    const active_disabled_summaries = active_zone_systems
        .map(system => {
            const disabled = disabled_by_system[system] ?? [];
            if (disabled.length === 0) return null;
            const visible = disabled.slice(0, MAX_VISIBLE_DISABLED_ZONES);
            const hidden_count = Math.max(0, disabled.length - MAX_VISIBLE_DISABLED_ZONES);
            return {
                system,
                disabled,
                text: visible.join(",") + (hidden_count > 0 ? ` +${hidden_count}` : ""),
            };
        })
        .filter(Boolean);
    const zone_label_active_color = colors.theme.text;
    const zone_label_inactive_color = colors.map_controls.zone_label_inactive;
    const zone_button_base_style = {
        border: `1px solid ${colors.theme.text}38`,
        background: `${colors.theme.text}14`,
    };

    const zone_button_active_style = {
        border: `1px solid ${colors.theme.text}80`,
        background: `${colors.theme.text}2E`,
    };

    const zone_button_hover_style = {
        border: `1px solid ${colors.theme.text}66`,
        background: `${colors.theme.text}24`,
    };

    const control_button_style = {
        backgroundColor: colors.theme.background,
        border: `1px solid ${colors.theme.text}38`,
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
        color: colors.buttons.utility,
    };

    const [zone_button_hover, set_zone_button_hover] = useState(null);

    const country_zone_overlays = [
        {
            id: "us_state",
            label: "US state",
            map_control_key: "show_us_states",
            title: "US state overlay",
        },
        {
            id: "ca_province",
            label: "Canada provinces",
            map_control_key: "show_can_states",
            title: "Canada provinces overlay",
        },
    ];

    function close_controls_panel() {
        set_show_controls_panel(false);
        set_show_mode_popup(false);
    }

    function toggle_controls_panel() {
        if (show_controls_panel) {
            set_show_mode_popup(false);
        }
        set_show_controls_panel(!show_controls_panel);
    }

    useEffect(() => {
        if (!show_controls_panel) return;

        function close_panel_on_click_outside(event) {
            if (!controls_panel_ref.current?.contains(event.target)) {
                close_controls_panel();
            }
        }

        function close_panel_on_escape(event) {
            if (event.key === "Escape") {
                close_controls_panel();
            }
        }

        document.addEventListener("mousedown", close_panel_on_click_outside);
        document.addEventListener("keydown", close_panel_on_escape);
        return () => {
            document.removeEventListener("mousedown", close_panel_on_click_outside);
            document.removeEventListener("keydown", close_panel_on_escape);
        };
    }, [show_controls_panel]);

    function reset_map() {
        const locator = settings.locator || "JJ00AA";
        const [lat, lon] = Maidenhead.toLatLon(locator);
        set_map_controls(state => {
            if (!auto_toggle_radius) {
                set_radius_in_km(settings.default_radius);
            }
            state.location = { displayed_locator: locator, location: [lon, lat] };
        });
    }

    const radio_status_to_color = {
        // Probably rig is not configured
        unknown: colors.map_controls.radio_unknown,
        // CAT control is working
        connected: colors.map_controls.radio_connected,
        // Radio or omnirig is disconnected
        disconnected: colors.map_controls.radio_disconnected,
    };

    function set_exclusive_overlay(map_control_key, show_overlay) {
        set_map_controls(state => {
            if (!show_overlay) {
                state[map_control_key] = false;
                return;
            }

            clear_exclusive_overlays(state);
            state[map_control_key] = true;
            state.show_us_states = false;
            state.show_can_states = false;
        });
    }

    function toggle_country_overlay(map_control_key, show_overlay) {
        set_map_controls(state => {
            state[map_control_key] = show_overlay;
            if (show_overlay) {
                clear_exclusive_overlays(state);
            }
        });
    }

    function toggle_equator() {
        set_map_controls(state => {
            state.show_equator = !state.show_equator;
        });
    }

    const overlay_buttons = [
        {
            id: "dxcc",
            label: "DXCC",
            map_control_key: "show_dxcc_labels",
            active: dxcc_labels_on,
            title: "DXCC labels",
            padding_class: "px-2",
            width_class: "w-12",
        },
        {
            id: "cq",
            label: "CQ",
            map_control_key: "show_cq_zones",
            active: cq_zones_on,
        },
        {
            id: "itu",
            label: "ITU",
            map_control_key: "show_itu_zones",
            active: itu_zones_on,
        },
    ];

    function render_overlay_button({
        id,
        label,
        map_control_key,
        active,
        title,
        padding_class = "px-1",
        width_class = "w-8",
    }) {
        return (
            <button
                key={id}
                onClick={() => set_exclusive_overlay(map_control_key, !active)}
                onMouseEnter={() => set_zone_button_hover(id)}
                onMouseLeave={() => set_zone_button_hover(null)}
                className={`flex items-center justify-center relative rounded-md ${padding_class} min-w-10`}
                style={{
                    ...zone_button_base_style,
                    ...(active ? zone_button_active_style : {}),
                    ...(zone_button_hover === id ? zone_button_hover_style : {}),
                }}
                title={title}
            >
                <span
                    className={`${width_class} h-8 flex items-center justify-center text-xl leading-none ${active ? "font-bold" : "font-medium"}`}
                    style={{
                        color: active ? zone_label_active_color : zone_label_inactive_color,
                    }}
                >
                    {label}
                </span>
            </button>
        );
    }

    return (
        <>
            <div
                ref={controls_panel_ref}
                className="absolute z-40 top-0 right-0 flex flex-col items-end m-2 gap-2"
            >
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={reset_map}
                        className="flex h-10 w-10 items-center justify-center rounded-lg"
                        style={control_button_style}
                        aria-label="Reset map"
                        title="Reset map"
                    >
                        <svg
                            height="24"
                            width="24"
                            viewBox="0 0 576 512"
                            fill="currentColor"
                            aria-hidden="true"
                        >
                            <path d="M575.8 255.5c0 18-15 32.1-32 32.1l-32 0 .7 160.2c0 2.7-.2 5.4-.5 8.1l0 16.2c0 22.1-17.9 40-40 40l-16 0c-1.1 0-2.2 0-3.3-.1c-1.4 .1-2.8 .1-4.2 .1L416 512l-24 0c-22.1 0-40-17.9-40-40l0-24 0-64c0-17.7-14.3-32-32-32l-64 0c-17.7 0-32 14.3-32 32l0 64 0 24c0 22.1-17.9 40-40 40l-24 0-31.9 0c-1.5 0-3-.1-4.5-.2c-1.2 .1-2.4 .2-3.6 .2l-16 0c-22.1 0-40-17.9-40-40l0-112c0-.9 0-1.9 .1-2.8l0-69.7-32 0c-18 0-32-14-32-32.1c0-9 3-17 10-24L266.4 8c7-7 15-8 22-8s15 2 21 7L564.8 231.5c8 7 12 15 11 24z" />
                        </svg>
                    </button>
                    {!is_mobile && (
                        <button
                            type="button"
                            onClick={toggle_map_fullscreen}
                            className="flex h-10 w-10 items-center justify-center rounded-lg"
                            style={control_button_style}
                            aria-label={is_map_fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                            title={is_map_fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                        >
                            <svg
                                height="24"
                                width="24"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                aria-hidden="true"
                            >
                                {is_map_fullscreen ? (
                                    <path d="M5 16h3v3h2v-5H5v2zM8 5v3H5v2h5V5H8zM16 19v-3h3v-2h-5v5h2zM14 5v5h5V8h-3V5h-2z" />
                                ) : (
                                    <path d="M9 5H5v4H3V5a2 2 0 0 1 2-2h4zM15 3h4a2 2 0 0 1 2 2v4h-2V5h-4zM3 15h2v4h4v2H5a2 2 0 0 1-2-2zM19 15h2v4a2 2 0 0 1-2 2h-4v-2h4z" />
                                )}
                            </svg>
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={toggle_history}
                        className="flex h-10 w-10 items-center justify-center rounded-lg"
                        style={{
                            ...control_button_style,
                            ...(is_history_mode
                                ? { color: colors.buttons.active ?? "#3b82f6" }
                                : {}),
                        }}
                        aria-label={is_history_mode ? "Exit history mode" : "Enter history mode"}
                        title={is_history_mode ? "Exit history mode" : "Enter history mode"}
                    >
                        <svg
                            height="24"
                            width="24"
                            viewBox="0 0 512 512"
                            fill="currentColor"
                            aria-hidden="true"
                        >
                            <path d="M256 8C119 8 8 119 8 256s111 248 248 248 248-111 248-248S393 8 256 8zm0 448c-110.5 0-200-89.5-200-200S145.5 56 256 56s200 89.5 200 200-89.5 200-200 200zm61.8-104.4l-84.9-61.7c-3.1-2.3-4.9-5.9-4.9-9.7V116c0-6.6 5.4-12 12-12h32c6.6 0 12 5.4 12 12v141.7l66.8 48.6c5.4 3.9 6.5 11.4 2.6 16.8L334.6 349c-3.9 5.3-11.4 6.5-16.8 2.6z" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        onClick={toggle_controls_panel}
                        className="flex h-10 w-10 items-center justify-center rounded-lg"
                        style={control_button_style}
                        aria-label={show_controls_panel ? "Hide map controls" : "Show map controls"}
                        aria-expanded={show_controls_panel}
                        title={show_controls_panel ? "Hide map controls" : "Show map controls"}
                    >
                        <svg
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
                            <path d="M4 6h10" />
                            <path d="M18 6h2" />
                            <circle cx="16" cy="6" r="2" />
                            <path d="M4 12h2" />
                            <path d="M10 12h10" />
                            <circle cx="8" cy="12" r="2" />
                            <path d="M4 18h8" />
                            <path d="M16 18h4" />
                            <circle cx="14" cy="18" r="2" />
                        </svg>
                    </button>
                </div>
                {show_controls_panel && (
                    <div
                        className="flex flex-col items-end gap-2 rounded-xl p-3 shadow-xl max-w-[calc(100vw-1rem)]"
                        style={{
                            backgroundColor: colors.theme.background,
                            border: `1px solid ${colors.theme.text}2E`,
                            color: colors.theme.text,
                        }}
                    >
                        <div className="flex items-center gap-3">
                            {radio_status != "unavailable" && can_undo_cat ? (
                                <Button
                                    color="utility"
                                    className="p-1"
                                    on_click={() => {
                                        if (!can_undo_cat) return;
                                        undo_cat();
                                    }}
                                >
                                    <svg
                                        fill="currentColor"
                                        width="24"
                                        height="24"
                                        viewBox="0 0 512 512"
                                    >
                                        <path d="M255.545 8c-66.269.119-126.438 26.233-170.86 68.685L48.971 40.971C33.851 25.851 8 36.559 8 57.941V192c0 13.255 10.745 24 24 24h134.059c21.382 0 32.09-25.851 16.971-40.971l-41.75-41.75c30.864-28.899 70.801-44.907 113.23-45.273 92.398-.798 170.283 73.977 169.484 169.442C423.236 348.009 349.816 424 256 424c-41.127 0-79.997-14.678-110.63-41.556-4.743-4.161-11.906-3.908-16.368.553L89.34 422.659c-4.872 4.872-4.631 12.815.482 17.433C133.798 479.813 192.074 504 256 504c136.966 0 247.999-111.033 248-247.998C504.001 119.193 392.354 7.755 255.545 8z" />
                                    </svg>
                                </Button>
                            ) : (
                                ""
                            )}
                            {radio_status != "unavailable" ? (
                                <Radio
                                    color={radio_status_to_color[radio_status]}
                                    size="40"
                                ></Radio>
                            ) : null}
                            <button
                                type="button"
                                onClick={toggle_equator}
                                className="flex h-10 w-10 items-center justify-center rounded-md"
                                style={{
                                    color: equator_on
                                        ? colors.buttons.utility
                                        : colors.buttons.disabled,
                                }}
                                aria-label={equator_on ? "Hide equator" : "Show equator"}
                                aria-pressed={equator_on}
                                title={equator_on ? "Hide equator" : "Show equator"}
                            >
                                <svg
                                    width="40"
                                    height="40"
                                    viewBox="0 0 40 40"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                >
                                    <circle cx="20" cy="20" r="15.5" strokeWidth="2.2" />
                                    <path
                                        d="M20 4.5c-4.4 4.4-6.8 9.7-6.8 15.5S15.6 31.1 20 35.5"
                                        strokeWidth="1.7"
                                        opacity="0.65"
                                    />
                                    <path
                                        d="M20 4.5c4.4 4.4 6.8 9.7 6.8 15.5S24.4 31.1 20 35.5"
                                        strokeWidth="1.7"
                                        opacity="0.65"
                                    />
                                    <path d="M7.5 14h25" strokeWidth="1.5" opacity="0.45" />
                                    <path d="M7.5 26h25" strokeWidth="1.5" opacity="0.45" />
                                    <path d="M4 20h32" strokeWidth="3.6" />
                                </svg>
                            </button>
                            <button
                                ref={mode_button_ref}
                                onClick={() =>
                                    set_map_controls(state => (state.is_globe = !state.is_globe))
                                }
                                onMouseEnter={() => set_show_mode_popup(true)}
                                onMouseLeave={() => set_show_mode_popup(false)}
                                className="flex items-center justify-center relative"
                            >
                                {map_controls.is_globe ? (
                                    <svg
                                        height="32"
                                        width="32"
                                        viewBox="0 0 16 16"
                                        fill="none"
                                        stroke={colors.buttons.utility}
                                        strokeWidth="1.25"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <circle cx="8" cy="8" r="7.1" />
                                        <circle cx="8" cy="8" r="4.1" />
                                        <path d="M8 1.2v13.6M1.2 8h13.6M3 3l10 10M13 3 3 13" />
                                    </svg>
                                ) : (
                                    <svg
                                        height="32"
                                        width="32"
                                        viewBox="0 0 16 16"
                                        fill={colors.buttons.utility}
                                    >
                                        <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m7.5-6.923c-.67.204-1.335.82-1.887 1.855A8 8 0 0 0 5.145 4H7.5zM4.09 4a9.3 9.3 0 0 1 .64-1.539 7 7 0 0 1 .597-.933A7.03 7.03 0 0 0 2.255 4zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.674a7 7 0 0 0-.656 2.5zM4.847 5a12.5 12.5 0 0 0-.338 2.5H7.5V5zM8.5 5v2.5h2.99a12.5 12.5 0 0 0-.337-2.5zM4.51 8.5a12.5 12.5 0 0 0 .337 2.5H7.5V8.5zm3.99 0V11h2.653c.187-.765.306-1.608.338-2.5zM5.145 12q.208.58.468 1.068c.552 1.035 1.218 1.65 1.887 1.855V12zm.182 2.472a7 7 0 0 1-.597-.933A9.3 9.3 0 0 1 4.09 12H2.255a7 7 0 0 0 3.072 2.472M3.82 11a13.7 13.7 0 0 1-.312-2.5h-2.49c.062.89.291 1.733.656 2.5zm6.853 3.472A7 7 0 0 0 13.745 12H11.91a9.3 9.3 0 0 1-.64 1.539 7 7 0 0 1-.597.933M8.5 12v2.923c.67-.204 1.335-.82 1.887-1.855q.26-.487.468-1.068zm3.68-1h2.146c.365-.767.594-1.61.656-2.5h-2.49a13.7 13.7 0 0 1-.312 2.5m2.802-3.5a7 7 0 0 0-.656-2.5H12.18c.174.782.282 1.623.312 2.5zM11.27 2.461c.247.464.462.98.64 1.539h1.835a7 7 0 0 0-3.072-2.472c.218.284.418.598.597.933M10.855 4a8 8 0 0 0-.468-1.068C9.835 1.897 9.17 1.282 8.5 1.077V4z" />
                                    </svg>
                                )}
                            </button>
                            {show_mode_popup && (
                                <Popup anchor_ref={mode_button_ref}>
                                    <div
                                        className="py-1 px-2 rounded shadow-lg text-xs"
                                        style={{
                                            color: colors.theme.text,
                                            background: colors.theme.background,
                                        }}
                                    >
                                        {map_controls.is_globe ? "Azimuthal mode" : "Globe mode"}
                                    </div>
                                </Popup>
                            )}
                            <Night
                                is_active={map_controls.night}
                                size="40"
                                on_click={event =>
                                    set_map_controls(state => (state.night = !state.night))
                                }
                            />
                        </div>
                        <div className="flex items-center gap-3">
                            {overlay_buttons.map(render_overlay_button)}
                        </div>
                        <div className="flex w-full flex-wrap justify-end gap-2">
                            {country_zone_overlays.map(overlay => {
                                const active = map_controls[overlay.map_control_key] ?? false;
                                return (
                                    <button
                                        key={overlay.id}
                                        onClick={() =>
                                            toggle_country_overlay(overlay.map_control_key, !active)
                                        }
                                        onMouseEnter={() => set_zone_button_hover(overlay.id)}
                                        onMouseLeave={() => set_zone_button_hover(null)}
                                        className="flex min-h-9 items-center justify-center whitespace-nowrap rounded-md px-3 text-center text-sm leading-tight"
                                        style={{
                                            ...zone_button_base_style,
                                            ...(active ? zone_button_active_style : {}),
                                            ...(zone_button_hover === overlay.id
                                                ? zone_button_hover_style
                                                : {}),
                                            color: active
                                                ? zone_label_active_color
                                                : zone_label_inactive_color,
                                        }}
                                        title={overlay.title}
                                    >
                                        <span className={active ? "font-bold" : "font-medium"}>
                                            {overlay.label}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        {active_disabled_summaries.length > 0 && (
                            <div
                                className="flex flex-col items-end gap-1 text-xs"
                                style={{ color: colors.theme.text }}
                            >
                                {active_disabled_summaries.map(summary => (
                                    <div key={summary.system} className="flex items-center gap-2">
                                        <span
                                            className="max-w-46"
                                            title={`${zone_system_labels[summary.system]} off: ${summary.disabled.join(",")}`}
                                        >
                                            {zone_system_labels[summary.system]} off: {summary.text}
                                        </span>
                                        <button
                                            className="underline"
                                            onClick={() => {
                                                setFilters(state => ({
                                                    ...state,
                                                    zone_filters: {
                                                        ...state.zone_filters,
                                                        disabled_by_system: {
                                                            ...(state.zone_filters
                                                                ?.disabled_by_system ?? {}),
                                                            [summary.system]: [],
                                                        },
                                                    },
                                                }));
                                            }}
                                            title={`Enable all zones in ${zone_system_labels[summary.system]}`}
                                        >
                                            Reset
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
            {propagation && settings.propagation_displayed && (
                <div
                    className="fixed md:absolute bottom-0 md:bottom-2 right-2 z-40 flex justify-end md:justify-center gap-2"
                    style={{ backgroundColor: colors.theme.background }}
                >
                    <PropagationBar
                        value={propagation.a_index.value}
                        timestamp={propagation.a_index.timestamp}
                        label="A"
                        min={0}
                        max={100}
                        low_mid={14}
                        mid_high={80}
                    />
                    <PropagationBar
                        value={propagation.k_index.value}
                        timestamp={propagation.k_index.timestamp}
                        label="K"
                        min={0}
                        max={9}
                        low_mid={3}
                        mid_high={5}
                    />
                    <PropagationBar
                        value={propagation.sfi.value}
                        timestamp={propagation.sfi.timestamp}
                        label="SFI"
                        min={0}
                        max={200}
                        low_mid={83}
                        mid_high={120}
                        reverse_colors={true}
                    />
                </div>
            )}
        </>
    );
}

export default MapControls;

import Maidenhead from "maidenhead";
import { useEffect, useState } from "react";

import Modal from "@/components/ui/Modal.jsx";
import Tabs from "@/components/ui/Tabs";
import { bands, modes } from "@/data/filters_data.js";
import { useColors } from "@/hooks/useColors";
import { useFilters } from "@/hooks/useFilters";
import use_radio from "@/hooks/useRadio";
import { useSettings } from "@/hooks/useSettings";
import { useLocalStorage, useMediaQuery } from "@uidotdev/usehooks";
import Bands from "./Bands";
import CatControl from "./CatControl";
import General from "./General";
import ImportExport from "./ImportExport";
import Layout from "./Layout";
import Profiles from "./Profiles";

function SettingsIcon({ size }) {
    const { colors } = useColors();

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path
                stroke={colors.buttons.utility}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.723 1.723 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37 1 .608 2.296.07 2.572-1.065Z"
            />
            <path
                stroke={colors.buttons.utility}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z"
            />
        </svg>
    );
}

const empty_temp_settings = {
    locator: "",
    default_radius: 0,
    theme: "",
    callsign: "",
    is_miles: false,
    propagation_displayed: true,
    main_view_mode: "both",
    main_view_order: "map_table",
    highlight_enabled: true,
    highlight_port: 2237,
    alert_sound_enabled: false,
    disabled_bands: Object.fromEntries(bands.map(band => [band, false])),
    show_disabled_bands: false,
    disabled_modes: Object.fromEntries(modes.map(mode => [mode, false])),
    show_disabled_modes: false,
};

function Settings({ set_map_controls, set_radius_in_km }) {
    const [temp_settings, set_temp_settings] = useState(empty_temp_settings);
    const { colors, setTheme } = useColors();
    const { settings, set_settings } = useSettings();
    const { setFilters, setProfileFilters, is_shared_filter_state } = useFilters();
    const { is_radio_available } = use_radio();
    const is_mobile_settings = useMediaQuery("only screen and (max-width : 768px)");

    const [first_launch, set_first_launch] = useLocalStorage("first_launch", true);
    const [should_open_settings, set_should_open_settings] = useState(false);

    function disable_settings_filters(current_filters, new_settings) {
        const updated_bands = { ...current_filters.bands };
        const updated_modes = { ...current_filters.modes };

        bands.forEach(band => {
            if (new_settings.disabled_bands[band]) {
                updated_bands[band] = false;
            }
        });

        modes.forEach(mode => {
            if (new_settings.disabled_modes[mode]) {
                updated_modes[mode] = false;
            }
        });

        return {
            ...current_filters,
            bands: updated_bands,
            modes: updated_modes,
        };
    }

    function apply_settings(new_settings) {
        const locator = new_settings.locator || "JJ00AA";
        const [lat, lon] = Maidenhead.toLatLon(locator);
        set_map_controls(map_controls => {
            map_controls.location.displayed_locator = locator;
            map_controls.location.location = [lon, lat];
            if (settings.default_radius != new_settings.default_radius) {
                set_radius_in_km(new_settings.default_radius);
            }
        });
        setTheme(new_settings.theme);
        set_settings(new_settings);

        const update_disabled_filters = current_filters =>
            disable_settings_filters(current_filters, new_settings);
        setFilters(update_disabled_filters);
        if (is_shared_filter_state) {
            setProfileFilters(update_disabled_filters);
        }
    }

    useEffect(() => {
        set_first_launch(false);

        if (first_launch === true && (settings.locator === "" || settings.locator === "JJ00AA")) {
            set_should_open_settings(true);
        }
    }, [first_launch]);

    function reset_temp_settings() {
        set_temp_settings(empty_temp_settings);
    }

    const tabs = [
        {
            label: "General",
            content: (
                <General
                    temp_settings={temp_settings}
                    set_temp_settings={set_temp_settings}
                    colors={colors}
                />
            ),
        },
        ...(!is_mobile_settings
            ? [
                  {
                      label: "Layout",
                      content: (
                          <Layout
                              temp_settings={temp_settings}
                              set_temp_settings={set_temp_settings}
                              colors={colors}
                          />
                      ),
                  },
              ]
            : []),
        {
            label: "Bands & Modes",
            content: (
                <Bands
                    temp_settings={temp_settings}
                    set_temp_settings={set_temp_settings}
                    colors={colors}
                />
            ),
        },
        {
            label: "Profiles",
            content: <Profiles colors={colors} set_temp_settings={set_temp_settings} />,
        },
        {
            label: "Import/Export",
            content: <ImportExport set_temp_settings={set_temp_settings} />,
        },
    ];

    if (is_radio_available()) {
        tabs.splice(1, 0, {
            label: "CAT Control",
            content: (
                <CatControl
                    temp_settings={temp_settings}
                    set_temp_settings={set_temp_settings}
                    colors={colors}
                />
            ),
        });
    }

    const is_locator_valid =
        temp_settings.locator === "" || Maidenhead.valid(temp_settings.locator);
    const is_default_radius_valid =
        temp_settings.default_radius >= 1000 &&
        temp_settings.default_radius <= 20000 &&
        temp_settings.default_radius % 1000 == 0;
    const is_settings_valid = is_locator_valid && is_default_radius_valid;

    return (
        <Modal
            title={
                <h3 className="text-3xl" style={{ color: colors.theme.text }}>
                    Settings
                </h3>
            }
            button={<SettingsIcon size="40"></SettingsIcon>}
            on_open={() => {
                set_temp_settings(settings);
            }}
            external_open={should_open_settings}
            on_apply={() => {
                if (is_settings_valid) {
                    apply_settings(temp_settings);
                    reset_temp_settings();
                }

                return is_settings_valid;
            }}
            on_cancel={() => reset_temp_settings()}
        >
            <div className="h-full w-[21rem] md:w-[42rem]">
                <Tabs tabs={tabs} />
            </div>
        </Modal>
    );
}

export { Settings, SettingsIcon };

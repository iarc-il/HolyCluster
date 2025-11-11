import { useState, useEffect } from "react";
import Maidenhead from "maidenhead";

import Modal from "@/components/Modal.jsx";
import { useColors } from "../hooks/useColors";
import { useLocalStorage } from "@uidotdev/usehooks";
import { useFilters } from "@/hooks/useFilters";
import { useSettings } from "@/hooks/useSettings";
import ImportExport from "./settings/ImportExport";
import General from "./settings/General";
import CatControl from "./settings/CatControl";
import Bands from "./settings/Bands";
import use_radio from "@/hooks/useRadio";
import Tabs from "./Tabs";
import { bands } from "@/filters_data.js";

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
    highlight_enabled: true,
    highlight_port: 2237,
    alert_sound_enabled: false,
    disabled_bands: Object.fromEntries(bands.map(band => [band, false])),
    show_disabled_bands: false,
};

function Settings({ set_map_controls, set_radius_in_km }) {
    const [temp_settings, set_temp_settings] = useState(empty_temp_settings);
    const { colors, setTheme } = useColors();
    const { settings, set_settings } = useSettings();
    const { filters, setFilters } = useFilters();
    const { is_radio_available } = use_radio();

    const [first_launch, set_first_launch] = useLocalStorage("first_launch", true);
    const [should_open_settings, set_should_open_settings] = useState(false);
    const [should_close_settings, set_should_close_settings] = useState(true);

    function apply_settings(new_settings) {
        const [lat, lon] = Maidenhead.toLatLon(new_settings.locator);
        set_map_controls(map_controls => {
            map_controls.location.displayed_locator = new_settings.locator;
            map_controls.location.location = [lon, lat];
            if (settings.default_radius != new_settings.default_radius) {
                set_radius_in_km(new_settings.default_radius);
            }
        });
        setTheme(new_settings.theme);
        set_settings(new_settings);

        setFilters(current_filters => {
            const updated_bands = { ...current_filters.bands };
            bands.forEach(band => {
                if (new_settings.disabled_bands[band]) {
                    updated_bands[band] = false;
                }
            });
            return {
                ...current_filters,
                bands: updated_bands,
            };
        });
    }

    useEffect(() => {
        set_first_launch(false);

        if (first_launch == true && settings.locator === "JJ00AA") {
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
        {
            label: "Bands",
            content: (
                <Bands
                    temp_settings={temp_settings}
                    set_temp_settings={set_temp_settings}
                    colors={colors}
                />
            ),
        },
        {
            label: "Import/Export",
            content: (
                <ImportExport
                    settings={settings}
                    set_settings={set_settings}
                    set_temp_settings={set_temp_settings}
                    apply_settings={apply_settings}
                    set_should_close_settings={set_should_close_settings}
                />
            ),
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

    const is_settings_valid =
        temp_settings.locator === "" ||
        (Maidenhead.valid(temp_settings.locator) &&
            temp_settings.default_radius >= 1000 &&
            temp_settings.default_radius <= 20000 &&
            temp_settings.default_radius % 1000 == 0);

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
            external_close={should_close_settings}
            on_apply={() => {
                if (is_settings_valid) {
                    apply_settings(temp_settings);
                    reset_temp_settings();
                }

                return is_settings_valid;
            }}
            on_cancel={() => reset_temp_settings()}
        >
            <div className="h-full w-[21rem]">
                <Tabs tabs={tabs} />
            </div>
        </Modal>
    );
}

export default Settings;

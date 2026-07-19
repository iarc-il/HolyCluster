import FilterButton from "@/components/FilterButton.jsx";
import { bands, modes } from "@/data/filters_data.js";

function Bands({ temp_settings, set_temp_settings, colors }) {
    const handle_band_toggle = band => {
        set_temp_settings({
            ...temp_settings,
            disabled_bands: {
                ...temp_settings.disabled_bands,
                [band]: !temp_settings.disabled_bands[band],
            },
        });
    };

    const handle_mode_toggle = mode => {
        set_temp_settings({
            ...temp_settings,
            disabled_modes: {
                ...temp_settings.disabled_modes,
                [mode]: !temp_settings.disabled_modes[mode],
            },
        });
    };

    return (
        <div className="p-4 grid grid-cols-2 gap-4" data-tour="settings-bands-modes">
            <div className="flex flex-col items-center" data-tour="settings-bands-section">
                <div className="flex flex-col gap-2 items-center">
                    {bands.map(band => {
                        const label = Number.isInteger(band) ? `${band}m` : band;
                        const is_enabled = !temp_settings.disabled_bands[band];
                        const color = colors.bands[band];

                        return (
                            <FilterButton
                                key={band}
                                text={label}
                                is_active={is_enabled}
                                color={color}
                                text_color={colors.text[band]}
                                data_tour={`settings-band-${band}`}
                                on_click={() => handle_band_toggle(band)}
                            />
                        );
                    })}
                </div>
            </div>

            <div className="flex flex-col items-center" data-tour="settings-modes-section">
                <div className="flex flex-col gap-2 items-center">
                    {modes.map(mode => {
                        const is_enabled = !temp_settings.disabled_modes[mode];

                        return (
                            <FilterButton
                                key={mode}
                                text={mode}
                                is_active={is_enabled}
                                color={colors.buttons.modes}
                                data_tour={`settings-mode-${mode}`}
                                on_click={() => handle_mode_toggle(mode)}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export default Bands;

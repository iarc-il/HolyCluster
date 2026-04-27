import Toggle from "@/components/ui/Toggle.jsx";
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
        <div className="p-4 grid grid-cols-2 gap-4">
            <div className="flex flex-col items-center">
                <table
                    className="table-fixed border-separate border-spacing-y-2 mb-4"
                    style={{ color: colors.theme.text }}
                >
                    <tbody>
                        <tr>
                            <td>Show disabled bands:&nbsp;&nbsp;</td>
                            <td>
                                <Toggle
                                    value={temp_settings.show_disabled_bands}
                                    on_click={() => {
                                        set_temp_settings({
                                            ...temp_settings,
                                            show_disabled_bands: !temp_settings.show_disabled_bands,
                                        });
                                    }}
                                />
                            </td>
                        </tr>
                    </tbody>
                </table>

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
                                on_click={() => handle_band_toggle(band)}
                            />
                        );
                    })}
                </div>
            </div>

            <div className="flex flex-col items-center">
                <table
                    className="table-fixed border-separate border-spacing-y-2 mb-4"
                    style={{ color: colors.theme.text }}
                >
                    <tbody>
                        <tr>
                            <td>Show disabled modes:&nbsp;&nbsp;</td>
                            <td>
                                <Toggle
                                    value={temp_settings.show_disabled_modes}
                                    on_click={() => {
                                        set_temp_settings({
                                            ...temp_settings,
                                            show_disabled_modes: !temp_settings.show_disabled_modes,
                                        });
                                    }}
                                />
                            </td>
                        </tr>
                    </tbody>
                </table>

                <div className="flex flex-col gap-2 items-center">
                    {modes.map(mode => {
                        const is_enabled = !temp_settings.disabled_modes[mode];

                        return (
                            <FilterButton
                                key={mode}
                                text={mode}
                                is_active={is_enabled}
                                color={colors.buttons.modes}
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

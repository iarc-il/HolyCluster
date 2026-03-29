import Toggle from "@/components/ui/Toggle.jsx";
import FilterButton from "@/components/FilterButton.jsx";
import { modes } from "@/data/filters_data.js";

function Modes({ temp_settings, set_temp_settings, colors }) {
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
        <div className="p-4 flex flex-col items-center">
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
                    const is_enabled = !temp_settings.disabled_modes?.[mode];
                    return (
                        <FilterButton
                            key={mode}
                            text={mode}
                            is_active={is_enabled}
                            color={colors.buttons.modes}
                            text_color={is_enabled ? "#000000" : colors.buttons.disabled}
                            on_click={() => handle_mode_toggle(mode)}
                        />
                    );
                })}
            </div>
        </div>
    );
}

export default Modes;

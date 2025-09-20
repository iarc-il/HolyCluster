import Input from "@/components/Input.jsx";
import Toggle from "@/components/Toggle.jsx";
import use_radio from "@/hooks/useRadio";

function CatControl({ temp_settings, set_temp_settings, colors }) {
    const { is_radio_available } = use_radio();

    if (!is_radio_available()) {
        return null;
    }

    const is_port_valid =
        temp_settings.highlight_port >= 1024 && temp_settings.highlight_port <= 65535;

    return (
        <div className="p-4">
            <table
                className="table-fixed border-separate border-spacing-y-2"
                style={{ color: colors.theme.text }}
            >
                <tbody>
                    <tr>
                        <td>Report callsign at click:&nbsp;&nbsp;</td>
                        <td>
                            <Toggle
                                value={temp_settings.highlight_enabled}
                                on_click={() => {
                                    set_temp_settings({
                                        ...temp_settings,
                                        highlight_enabled: !temp_settings.highlight_enabled,
                                    });
                                }}
                            />
                        </td>
                    </tr>
                    <tr>
                        <td>UDP Port:</td>
                        <td>
                            <Input
                                value={temp_settings.highlight_port}
                                className={is_port_valid ? "" : "bg-red-200"}
                                type="number"
                                min="1024"
                                max="65535"
                                onChange={event => {
                                    set_temp_settings({
                                        ...temp_settings,
                                        highlight_port: parseInt(event.target.value),
                                    });
                                }}
                            />
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

export default CatControl;

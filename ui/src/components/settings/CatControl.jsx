import Input from "@/components/ui/Input.jsx";
import Toggle from "@/components/ui/Toggle.jsx";
import use_radio from "@/hooks/useRadio";
import { useState } from "react";
import LoggerIntegrationHelp from "./LoggerIntegrationHelp.jsx";

function CatControl({ temp_settings, set_temp_settings, colors }) {
    const { is_radio_available } = use_radio();

    const is_port_valid =
        temp_settings.highlight_port >= 1024 && temp_settings.highlight_port <= 65535;

    return (
        <>
            <div className="p-4" data-tour="settings-cat-control">
                <table
                    className="table-fixed border-separate border-spacing-y-2"
                    style={{ color: colors.theme.text }}
                >
                    <tbody>
                        <tr>
                            <td>Enable logger integration:&nbsp;&nbsp;</td>
                            <td className="flex gap-2">
                                <Toggle
                                    value={temp_settings.highlight_enabled}
                                    data_tour="settings-cat-logger-toggle"
                                    on_click={() => {
                                        set_temp_settings({
                                            ...temp_settings,
                                            highlight_enabled: !temp_settings.highlight_enabled,
                                        });
                                    }}
                                />
                                <LoggerIntegrationHelp colors={colors} />
                            </td>
                        </tr>
                        <tr>
                            <td>UDP Port:</td>
                            <td>
                                <Input
                                    value={temp_settings.highlight_port}
                                    className={is_port_valid ? "" : "bg-red-200"}
                                    data-tour="settings-cat-udp-port"
                                    type="number"
                                    min="1024"
                                    max="65535"
                                    onChange={event => {
                                        set_temp_settings({
                                            ...temp_settings,
                                            highlight_port: Number.parseInt(event.target.value),
                                        });
                                    }}
                                />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </>
    );
}

export default CatControl;

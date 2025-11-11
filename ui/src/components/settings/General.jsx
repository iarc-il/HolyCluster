import Input from "@/components/Input.jsx";
import Select from "@/components/Select.jsx";
import Toggle from "@/components/Toggle.jsx";
import { themes_names } from "@/hooks/useColors";
import Maidenhead from "maidenhead";

function General({ temp_settings, set_temp_settings, colors }) {
    const is_locator_valid = Maidenhead.valid(temp_settings.locator);
    const is_default_radius_valid =
        temp_settings.default_radius >= 1000 &&
        temp_settings.default_radius <= 20000 &&
        temp_settings.default_radius % 1000 == 0;

    return (
        <div className="p-4">
            <table
                className="table-fixed border-separate border-spacing-y-2"
                style={{ color: colors.theme.text }}
            >
                <tbody>
                    <tr>
                        <td>My callsign:</td>
                        <td>
                            <Input
                                value={temp_settings.callsign}
                                maxLength={11}
                                className="uppercase"
                                autoFocus={true}
                                onChange={event => {
                                    set_temp_settings({
                                        ...temp_settings,
                                        callsign: event.target.value.toUpperCase(),
                                    });
                                }}
                            />
                        </td>
                    </tr>
                    <tr>
                        <td>My locator:</td>
                        <td>
                            <Input
                                value={temp_settings.locator}
                                className={is_locator_valid ? "" : "bg-red-200"}
                                onChange={event => {
                                    set_temp_settings({
                                        ...temp_settings,
                                        locator: event.target.value,
                                    });
                                }}
                            />
                        </td>
                    </tr>
                    <tr>
                        <td>Default map radius:</td>
                        <td>
                            <Input
                                value={temp_settings.default_radius}
                                className={is_default_radius_valid ? "" : "bg-red-200"}
                                type="number"
                                step="1000"
                                min="1000"
                                max="20000"
                                onChange={event => {
                                    set_temp_settings({
                                        ...temp_settings,
                                        default_radius: event.target.value,
                                    });
                                }}
                            />
                        </td>
                    </tr>
                    <tr>
                        <td>Theme:</td>
                        <td>
                            <Select
                                value={temp_settings.theme}
                                onChange={event => {
                                    set_temp_settings(state => ({
                                        ...state,
                                        theme: event.target.value,
                                    }));
                                }}
                            >
                                {themes_names.map(name => {
                                    return (
                                        <option key={name} value={name}>
                                            {name}
                                        </option>
                                    );
                                })}
                            </Select>
                        </td>
                    </tr>
                    <tr>
                        <td>Distance Units:&nbsp;&nbsp;</td>
                        <td>
                            <Select
                                value={temp_settings.is_miles}
                                onChange={event => {
                                    set_temp_settings({
                                        ...temp_settings,
                                        is_miles: JSON.parse(event.target.value),
                                    });
                                }}
                            >
                                {[
                                    { key: "km", value: false },
                                    { key: "miles", value: true },
                                ].map(unit => {
                                    return (
                                        <option key={unit.key} value={unit.value}>
                                            {unit.key}
                                        </option>
                                    );
                                })}
                            </Select>
                        </td>
                    </tr>
                    <tr>
                        <td>Propagation:&nbsp;&nbsp;</td>
                        <td>
                            <Toggle
                                value={temp_settings.propagation_displayed}
                                on_click={() => {
                                    set_temp_settings({
                                        ...temp_settings,
                                        propagation_displayed: !temp_settings.propagation_displayed,
                                    });
                                }}
                            />
                        </td>
                    </tr>
                    <tr>
                        <td>Show flags:&nbsp;&nbsp;</td>
                        <td>
                            <Toggle
                                value={temp_settings.show_flags}
                                on_click={() => {
                                    set_temp_settings({
                                        ...temp_settings,
                                        show_flags: !temp_settings.show_flags,
                                    });
                                }}
                            />
                        </td>
                    </tr>
                    <tr>
                        <td>Show equator:&nbsp;&nbsp;</td>
                        <td>
                            <Toggle
                                value={temp_settings.show_equator}
                                on_click={() => {
                                    set_temp_settings({
                                        ...temp_settings,
                                        show_equator: !temp_settings.show_equator,
                                    });
                                }}
                            />
                        </td>
                    </tr>
                    <tr>
                        <td>Alert sound:&nbsp;&nbsp;</td>
                        <td>
                            <Toggle
                                value={temp_settings.alert_sound_enabled}
                                on_click={() => {
                                    set_temp_settings({
                                        ...temp_settings,
                                        alert_sound_enabled: !temp_settings.alert_sound_enabled,
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

export default General;

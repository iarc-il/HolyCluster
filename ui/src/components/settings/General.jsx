import Input from "@/components/Input.jsx";
import Select from "@/components/Select.jsx";
import Toggle from "@/components/Toggle.jsx";
import { themes_names, useColors } from "@/hooks/useColors";
import { play_alert_sound } from "@/utils.js";
import Maidenhead from "maidenhead";

function SoundIcon({ size }) {
    const { colors } = useColors();

    return (
        <svg width={size} height={size} viewBox="0 0 512 512">
            <g stroke="none" stroke-width="1" fill="none" fillRule="evenodd">
                <g
                    id="icon"
                    fill={colors.buttons.utility}
                    transform="translate(42.666667, 85.333333)"
                >
                    <path d="M361.299413,341.610667 L328.014293,314.98176 C402.206933,233.906133 402.206933,109.96608 328.013013,28.8906667 L361.298133,2.26304 C447.910187,98.97536 447.908907,244.898347 361.299413,341.610667 Z M276.912853,69.77216 L243.588693,96.4309333 C283.38432,138.998613 283.38304,204.87488 243.589973,247.44256 L276.914133,274.101333 C329.118507,215.880107 329.118507,127.992107 276.912853,69.77216 Z M191.749973,1.42108547e-14 L80.8957867,87.2292267 L7.10542736e-15,87.2292267 L7.10542736e-15,257.895893 L81.0208,257.895893 L191.749973,343.35424 L191.749973,1.42108547e-14 L191.749973,1.42108547e-14 Z M42.6666667,129.895893 L95.6874667,129.895893 L149.083307,87.8749867 L149.083307,256.520747 L95.5624533,215.229227 L42.6666667,215.229227 L42.6666667,129.895893 Z"></path>
                </g>
            </g>
        </svg>
    );
}

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
                        <td className="flex gap-2">
                            <Toggle
                                value={temp_settings.alert_sound_enabled}
                                on_click={() => {
                                    set_temp_settings({
                                        ...temp_settings,
                                        alert_sound_enabled: !temp_settings.alert_sound_enabled,
                                    });
                                }}
                            />
                            <button onClick={play_alert_sound} className="h-full">
                                <SoundIcon size="24" />
                            </button>
                        </td>
                    </tr>
                    <tr>
                        <td>Single spot per station:&nbsp;&nbsp;</td>
                        <td>
                            <Toggle
                                value={temp_settings.show_only_latest_spot}
                                on_click={() => {
                                    set_temp_settings({
                                        ...temp_settings,
                                        show_only_latest_spot: !temp_settings.show_only_latest_spot,
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

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

function HelpIcon({ size }) {
    const { colors } = useColors();

    return (
        <svg height={size} width={size} viewBox="0 0 512 512">
            <path
                fill={colors.buttons.utility}
                d="M396.138,85.295c-13.172-25.037-33.795-45.898-59.342-61.03C311.26,9.2,280.435,0.001,246.98,0.001
                c-41.238-0.102-75.5,10.642-101.359,25.521c-25.962,14.826-37.156,32.088-37.156,32.088c-4.363,3.786-6.824,9.294-6.721,15.056
                c0.118,5.77,2.775,11.186,7.273,14.784l35.933,28.78c7.324,5.864,17.806,5.644,24.875-0.518c0,0,4.414-7.978,18.247-15.88
                c13.91-7.85,31.945-14.173,58.908-14.258c23.517-0.051,44.022,8.725,58.016,20.717c6.952,5.941,12.145,12.594,15.328,18.68
                c3.208,6.136,4.379,11.5,4.363,15.574c-0.068,13.766-2.742,22.77-6.603,30.442c-2.945,5.729-6.789,10.813-11.738,15.744
                c-7.384,7.384-17.398,14.207-28.634,20.479c-11.245,6.348-23.365,11.932-35.612,18.68c-13.978,7.74-28.77,18.858-39.701,35.544
                c-5.449,8.249-9.71,17.686-12.416,27.641c-2.742,9.964-3.98,20.412-3.98,31.071c0,11.372,0,20.708,0,20.708
                c0,10.719,8.69,19.41,19.41,19.41h46.762c10.719,0,19.41-8.691,19.41-19.41c0,0,0-9.336,0-20.708c0-4.107,0.467-6.755,0.917-8.436
                c0.773-2.512,1.206-3.14,2.47-4.668c1.29-1.452,3.895-3.674,8.698-6.331c7.019-3.946,18.298-9.276,31.07-16.176
                c19.121-10.456,42.367-24.646,61.972-48.062c9.752-11.686,18.374-25.758,24.323-41.968c6.001-16.21,9.242-34.431,9.226-53.96
                C410.243,120.761,404.879,101.971,396.138,85.295z"
            />
            <path
                fill={colors.buttons.utility}
                d="M228.809,406.44c-29.152,0-52.788,23.644-52.788,52.788c0,29.136,23.637,52.772,52.788,52.772
                c29.136,0,52.763-23.636,52.763-52.772C281.572,430.084,257.945,406.44,228.809,406.44z"
            />
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
                            <button
                                className="cursor-help"
                                title="If you don't hear anything, check the computer's volume or soundcard settings"
                            >
                                <HelpIcon size="20" />
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

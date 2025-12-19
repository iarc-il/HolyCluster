import { useRef, useState } from "react";
import Input from "@/components/Input.jsx";
import CallsignInput from "@/components/CallsignInput.jsx";
import Select from "@/components/Select.jsx";
import Toggle from "@/components/Toggle.jsx";
import Popup from "@/components/Popup.jsx";
import HelpIcon from "@/components/HelpIcon.jsx";
import { themes_names, useColors } from "@/hooks/useColors";
import { play_alert_sound, get_base_url } from "@/utils.js";
import Maidenhead from "maidenhead";

function PlayIcon({ size }) {
    const { colors } = useColors();

    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M3 5.49686C3 3.17662 5.52116 1.73465 7.52106 2.91106L18.5764 9.41423C20.5484 10.5742 20.5484 13.4259 18.5764 14.5858L7.52106 21.089C5.52116 22.2654 3 20.8234 3 18.5032V5.49686Z"
                fill="#00FF00"
            />
        </svg>
    );
}

async function fetch_locator(callsign) {
    if (!callsign) return null;
    try {
        const response = await fetch(`${get_base_url()}/locator/${callsign}`);
        const data = await response.json();
        return data.locator || null;
    } catch {
        return null;
    }
}

function General({ temp_settings, set_temp_settings, colors }) {
    const help_button_ref = useRef(null);
    const [show_help_popup, set_show_help_popup] = useState(false);
    const [is_locator_queried, set_is_locator_queried] = useState(false);
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
                            <CallsignInput
                                value={temp_settings.callsign}
                                maxLength={11}
                                autoFocus={true}
                                onChange={async event => {
                                    const new_callsign = event.target.value;
                                    set_temp_settings({
                                        ...temp_settings,
                                        callsign: new_callsign,
                                    });

                                    if (temp_settings.locator == "" || is_locator_queried) {
                                        const locator = await fetch_locator(new_callsign);
                                        if (locator) {
                                            set_is_locator_queried(true);
                                            set_temp_settings(prev => ({
                                                ...prev,
                                                locator: locator,
                                            }));
                                        }
                                    }
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
                                    set_is_locator_queried(false);
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
                                <PlayIcon size="24" />
                            </button>
                            <button
                                ref={help_button_ref}
                                className="cursor-auto"
                                onMouseEnter={() => set_show_help_popup(true)}
                                onMouseLeave={() => set_show_help_popup(false)}
                            >
                                <HelpIcon size="20" />
                            </button>
                            {show_help_popup && (
                                <Popup anchor_ref={help_button_ref}>
                                    <div
                                        className="py-1 px-2 rounded shadow-lg max-w-xs"
                                        style={{
                                            color: colors.theme.text,
                                            background: colors.theme.background,
                                        }}
                                    >
                                        Click the play button. If you don't hear anything, check the
                                        computer's volume or soundcard settings.
                                    </div>
                                </Popup>
                            )}
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

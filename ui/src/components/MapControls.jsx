import { useMediaQuery } from "@uidotdev/usehooks";

import Input from "@/components/Input.jsx";
import Button from "@/components/Button.jsx";
import Radio from "@/components/Radio.jsx";
import Night from "@/components/Night.jsx";
import PropagationBar from "@/components/PropagationBar.jsx";
import { useColors } from "@/hooks/useColors";
import { useServerData } from "@/hooks/useServerData";
import use_radio from "@/hooks/useRadio";
import { useSettings } from "@/hooks/useSettings";

import Maidenhead from "maidenhead";

function MapControls({
    map_controls,
    set_map_controls,
    set_radius_in_km,
    auto_toggle_radius,
    can_undo_cat,
    undo_cat,
}) {
    const { colors, dev_mode } = useColors();
    const { propagation } = useServerData();
    const { radio_status } = use_radio();
    const { settings } = useSettings();

    function reset_map() {
        const locator = settings.locator || "JJ00AA";
        const [lat, lon] = Maidenhead.toLatLon(locator);
        set_map_controls(state => {
            if (!auto_toggle_radius) {
                set_radius_in_km(settings.default_radius);
            }
            state.location = { displayed_locator: locator, location: [lon, lat] };
        });
    }

    const radio_status_to_color = {
        // Probably rig is not configured
        unknown: "#888888",
        // CAT control is working
        connected: "#00DD00",
        // Radio or omnirig is disconnected
        disconnected: "#DD0000",
    };

    const is_md_device = useMediaQuery("only screen and (min-width : 768px)");
    return (
        <>
            <div className="absolute top-0 z-40 right-0 flex justify-end mr-2 pt-2 xs:pt-4 gap-2 xs:gap-4 mb-2">
                {radio_status != "unavailable" && can_undo_cat ? (
                    <Button
                        color="utility"
                        className="p-1"
                        on_click={() => {
                            if (!can_undo_cat) return;
                            undo_cat();
                        }}
                    >
                        <svg fill="currentColor" width="24" height="24" viewBox="0 0 512 512">
                            <path d="M255.545 8c-66.269.119-126.438 26.233-170.86 68.685L48.971 40.971C33.851 25.851 8 36.559 8 57.941V192c0 13.255 10.745 24 24 24h134.059c21.382 0 32.09-25.851 16.971-40.971l-41.75-41.75c30.864-28.899 70.801-44.907 113.23-45.273 92.398-.798 170.283 73.977 169.484 169.442C423.236 348.009 349.816 424 256 424c-41.127 0-79.997-14.678-110.63-41.556-4.743-4.161-11.906-3.908-16.368.553L89.34 422.659c-4.872 4.872-4.631 12.815.482 17.433C133.798 479.813 192.074 504 256 504c136.966 0 247.999-111.033 248-247.998C504.001 119.193 392.354 7.755 255.545 8z" />
                        </svg>
                    </Button>
                ) : (
                    ""
                )}
                <div className="ml-auto flex items-center gap-2">
                    {
                        // Remove this when we release the radio CAT control feature!!!
                        radio_status != "unavailable" ? (
                            <Radio color={radio_status_to_color[radio_status]} size="40"></Radio>
                        ) : null
                    }
                </div>
                {dev_mode && (
                    <button
                        onClick={() =>
                            set_map_controls(state => (state.is_globe = !state.is_globe))
                        }
                        className="flex items-center justify-center relative"
                        title={map_controls.is_globe ? "Switch to Azimuthal" : "Switch to Globe"}
                    >
                        <svg
                            height="32"
                            width="32"
                            viewBox="0 0 16 16"
                            fill={colors.buttons.utility}
                        >
                            <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m7.5-6.923c-.67.204-1.335.82-1.887 1.855A8 8 0 0 0 5.145 4H7.5zM4.09 4a9.3 9.3 0 0 1 .64-1.539 7 7 0 0 1 .597-.933A7.03 7.03 0 0 0 2.255 4zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.674a7 7 0 0 0-.656 2.5zM4.847 5a12.5 12.5 0 0 0-.338 2.5H7.5V5zM8.5 5v2.5h2.99a12.5 12.5 0 0 0-.337-2.5zM4.51 8.5a12.5 12.5 0 0 0 .337 2.5H7.5V8.5zm3.99 0V11h2.653c.187-.765.306-1.608.338-2.5zM5.145 12q.208.58.468 1.068c.552 1.035 1.218 1.65 1.887 1.855V12zm.182 2.472a7 7 0 0 1-.597-.933A9.3 9.3 0 0 1 4.09 12H2.255a7 7 0 0 0 3.072 2.472M3.82 11a13.7 13.7 0 0 1-.312-2.5h-2.49c.062.89.291 1.733.656 2.5zm6.853 3.472A7 7 0 0 0 13.745 12H11.91a9.3 9.3 0 0 1-.64 1.539 7 7 0 0 1-.597.933M8.5 12v2.923c.67-.204 1.335-.82 1.887-1.855q.26-.487.468-1.068zm3.68-1h2.146c.365-.767.594-1.61.656-2.5h-2.49a13.7 13.7 0 0 1-.312 2.5m2.802-3.5a7 7 0 0 0-.656-2.5H12.18c.174.782.282 1.623.312 2.5zM11.27 2.461c.247.464.462.98.64 1.539h1.835a7 7 0 0 0-3.072-2.472c.218.284.418.598.597.933M10.855 4a8 8 0 0 0-.468-1.068C9.835 1.897 9.17 1.282 8.5 1.077V4z" />
                        </svg>
                        {map_controls.is_globe && (
                            <span className="absolute top-0 right-0 w-2 h-2 bg-green-500 rounded-full" />
                        )}
                    </button>
                )}
                <button onClick={reset_map}>
                    <svg height="32" width="32" viewBox="0 0 576 512" fill={colors.buttons.utility}>
                        <path d="M575.8 255.5c0 18-15 32.1-32 32.1l-32 0 .7 160.2c0 2.7-.2 5.4-.5 8.1l0 16.2c0 22.1-17.9 40-40 40l-16 0c-1.1 0-2.2 0-3.3-.1c-1.4 .1-2.8 .1-4.2 .1L416 512l-24 0c-22.1 0-40-17.9-40-40l0-24 0-64c0-17.7-14.3-32-32-32l-64 0c-17.7 0-32 14.3-32 32l0 64 0 24c0 22.1-17.9 40-40 40l-24 0-31.9 0c-1.5 0-3-.1-4.5-.2c-1.2 .1-2.4 .2-3.6 .2l-16 0c-22.1 0-40-17.9-40-40l0-112c0-.9 0-1.9 .1-2.8l0-69.7-32 0c-18 0-32-14-32-32.1c0-9 3-17 10-24L266.4 8c7-7 15-8 22-8s15 2 21 7L564.8 231.5c8 7 12 15 11 24z" />
                    </svg>
                </button>
                <Night
                    is_active={map_controls.night}
                    size="40"
                    on_click={event => set_map_controls(state => (state.night = !state.night))}
                />
            </div>
            {propagation && is_md_device && settings.propagation_displayed && (
                <div className="absolute bottom-2 z-40 right-5 flex justify-center pt-1 xs:pt-2 gap-1 xs:gap-2">
                    <PropagationBar
                        value={propagation.a_index.value}
                        timestamp={propagation.a_index.timestamp}
                        label="A"
                        min={0}
                        max={100}
                        low_mid={14}
                        mid_high={80}
                    />
                    <PropagationBar
                        value={propagation.k_index.value}
                        timestamp={propagation.k_index.timestamp}
                        label="K"
                        min={0}
                        max={9}
                        low_mid={3}
                        mid_high={5}
                    />
                    <PropagationBar
                        value={propagation.sfi.value}
                        timestamp={propagation.sfi.timestamp}
                        label="SFI"
                        min={0}
                        max={200}
                        low_mid={83}
                        mid_high={120}
                        reverse_colors={true}
                    />
                </div>
            )}
        </>
    );
}

export default MapControls;

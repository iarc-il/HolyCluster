import { use_object_local_storage, km_to_miles } from "@/utils.js";
import { useColors } from "../hooks/useColors";

function SpotPopup({
    hovered_spot,
    set_hovered_spot,
    set_pinned_spot,
    popup_position,
    hovered_spot_data,
    distance,
    settings,
    azimuth,
}) {
    const { colors } = useColors();

    if (hovered_spot_data == null) {
        return <></>;
    }

    return (
        <div
            className="absolute p-2 w-fit bg-white border border-gray-300 rounded shadow-lg z-50"
            onMouseOver={() => set_hovered_spot(hovered_spot)}
            onMouseLeave={() => set_hovered_spot({ source: null, id: null })}
            onClick={() => set_pinned_spot(hovered_spot)}
            style={{
                top: popup_position.y,
                left: popup_position.x,
                transform: "translate(-50%, -105%)",
            }}
        >
            <div className="text-gray-700 text-sm font-bold">
                DX:{" "}
                <p className="inline" style={{ color: colors.bands[hovered_spot_data.band] }}>
                    {hovered_spot_data.dx_callsign} ({hovered_spot_data.freq}
                    {"continent_dx" in hovered_spot_data
                        ? ", " + hovered_spot_data.continent_dx
                        : ""}
                    )<br />
                </p>
                DX Country:{" "}
                <p className="inline" style={{ color: colors.bands[hovered_spot_data.band] }}>
                    {hovered_spot_data.dx_country}
                    <br />
                </p>
                Spotter:{" "}
                <p className="inline" style={{ color: colors.bands[hovered_spot_data.band] }}>
                    {hovered_spot_data.spotter_callsign}
                    <br />
                </p>
                Distance:{" "}
                <p className="inline" style={{ color: colors.bands[hovered_spot_data.band] }}>
                    {settings.is_miles ? km_to_miles(distance) : distance}{" "}
                    {settings.is_miles ? "Miles" : "KM"}
                </p>
                <br />
                Azimuth:{" "}
                <p className="inline" style={{ color: colors.bands[hovered_spot_data.band] }}>
                    {Math.round(azimuth)}°
                </p>
                <p>
                    <small>(Click to freeze)</small>
                </p>
            </div>
        </div>
    );
}

export default SpotPopup;

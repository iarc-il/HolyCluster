import { km_to_miles } from "@/utils.js";
import { useColors } from "@/hooks/useColors";

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
            className="absolute w-fit z-50 bottom-2 left-2 border-l-4 pl-2"
            onMouseOver={() => set_hovered_spot(hovered_spot)}
            onMouseLeave={() => set_hovered_spot({ source: null, id: null })}
            onClick={() => set_pinned_spot(hovered_spot)}
            style={{ borderColor: colors.bands[hovered_spot_data.band] }}
        >
            <div className="text-sm font-bold" style={{ color: colors.text }}>
                <p>
                    DX: {hovered_spot_data.dx_callsign}
                    {hovered_spot_data.freq}
                    {"continent_dx" in hovered_spot_data
                        ? ", " + hovered_spot_data.continent_dx
                        : ""}
                </p>
                <p>DX Country: {hovered_spot_data.dx_country}</p>
                <p>Spotter: {hovered_spot_data.spotter_callsign}</p>
                <p>
                    Distance: {settings.is_miles ? km_to_miles(distance) : distance}{" "}
                    {settings.is_miles ? "Miles" : "KM"}
                </p>
                <p>Azimuth: {Math.round(azimuth)}°</p>
                <p>
                    <small>(Click to freeze)</small>
                </p>
            </div>
        </div>
    );
}

export default SpotPopup;

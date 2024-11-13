import { useEffect, forwardRef, useRef } from "react";

import { band_colors, band_light_colors } from "@/filters_data.js";

function Callsign({ callsign, is_alerted }) {
    return <a
        className={is_alerted ? "bg-emerald-100" : ""}
        href={"https://www.qrz.com/db/" + callsign}
        target="_blank"
    >{callsign}</a>
}

function Spot({
    spot,
    alerts,
    hovered_spot,
    pinned_spot,
    set_pinned_spot,
    set_hovered_spot,
    set_cat_to_spot,
}, ref) {

    const time = new Date(spot.time * 1000);
    const utc_hours = String(time.getUTCHours()).padStart(2, "0")
    const utc_minutes = String(time.getUTCMinutes()).padStart(2, "0");
    const formatted_time = utc_hours + ":" + utc_minutes;
    const is_hovered = spot.id == hovered_spot.id || spot.id == pinned_spot;
    const is_alerted = alerts.some(regex => spot.dx_callsign.match(regex));

    return <tr
        ref={ref}
        style={{
            backgroundColor: is_hovered ? band_light_colors[spot.band] : "",
        }}
        className="odd:bg-white even:bg-slate-100"
        onMouseEnter={() => set_hovered_spot({source: "table", id: spot.id})}
        onClick={() => set_pinned_spot(spot.id)}
    >
        <td>{formatted_time}</td>
        <td><Callsign callsign={spot.dx_callsign} is_alerted={is_alerted}></Callsign></td>
        <td>
            <div className="cursor-pointer" onClick={() => set_cat_to_spot(spot)}>
                {spot.freq}
            </div>
        </td>
        <td><Callsign callsign={spot.spotter_callsign}></Callsign></td>
        <td className="flex justify-center items-center">
            <p
                className="w-fit px-3 rounded-xl"
                style={{ backgroundColor: band_colors.get(spot.band) }}
            >
                <strong>{spot.band}</strong>
            </p>
        </td>
        <td>{spot.mode}</td>
    </tr>;
}

Spot = forwardRef(Spot);

function SpotsTable({
    spots,
    hovered_spot,
    set_hovered_spot,
    pinned_spot,
    set_pinned_spot,
    set_cat_to_spot,
    alerts,
}) {
    const row_refs = useRef({});

    useEffect(() => {
        const hovered_ref = row_refs.current[hovered_spot.id];
        const pinned_ref = row_refs.current[pinned_spot];

        if (pinned_ref != undefined) {
            pinned_ref.scrollIntoView({block: "center", behavior: "instant"});
        } else if (hovered_ref != undefined && hovered_spot.source == "map") {
            hovered_ref.scrollIntoView({block: "center", behavior: "instant"});
        }
    });

    return <div className="w-full h-full overflow-y-auto">
        <table
            className="table-fixed text-center w-[34rem]"
            onMouseLeave={_ => set_hovered_spot({source: null, id: null})}
        >
            <tbody className="divide-y divide-slate-200">
                <tr className="sticky top-0 bg-slate-300">
                    <td>Time</td>
                    <td>DX</td>
                    <td>Frequency</td>
                    <td>Spotter</td>
                    <td>Band</td>
                    <td>Mode</td>
                </tr>
                {spots
                    .map(spot => <Spot
                            ref={element => row_refs.current[spot.id] = element}
                            key={spot.id}
                            spot={spot}
                            alerts={alerts}
                            hovered_spot={hovered_spot}
                            pinned_spot={pinned_spot}
                            set_pinned_spot={set_pinned_spot}
                            set_hovered_spot={set_hovered_spot}
                            set_cat_to_spot={set_cat_to_spot}
                        ></Spot>
                    )}
            </tbody>
        </table>
    </div>;
}

export default SpotsTable;

import { band_colors, band_light_colors } from "@/bands_and_modes.js";

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
    set_hovered_spot,
    on_spot_click,
}) {

    const time = new Date(spot.time * 1000);
    const utc_hours = String(time.getUTCHours()).padStart(2, "0")
    const utc_minutes = String(time.getUTCMinutes()).padStart(2, "0");
    const formatted_time = utc_hours + ":" + utc_minutes;
    const is_alerted = alerts.some(regex => spot.dx_callsign.match(regex));

    return <tr
        key={spot.id}
        style={{
            backgroundColor: spot.id == hovered_spot ? band_light_colors[spot.band] : "",
        }}
        className="odd:bg-white even:bg-slate-100"
        onMouseEnter={() => set_hovered_spot(spot.id)}
    >
        <td>{formatted_time}</td>
        <td><Callsign callsign={spot.dx_callsign} is_alerted={is_alerted}></Callsign></td>
        <td><Callsign callsign={spot.spotter_callsign}></Callsign></td>
        <td>
            <div className="cursor-pointer" onClick={() => on_spot_click(spot)}>
                {spot.freq}
            </div>
        </td>
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

function SpotsTable({
    spots,
    hovered_spot,
    set_hovered_spot,
    on_spot_click,
    alerts,
}) {
    return <table
        className="table-fixed w-full"
        onMouseLeave={() => set_hovered_spot(null)}
    >
        <tbody className="divide-y divide-slate-200">
            <tr className="sticky top-0 bg-slate-300">
                <td>Time</td>
                <td>DX</td>
                <td>Spotter</td>
                <td>Frequency</td>
                <td>Band</td>
                <td>Mode</td>
            </tr>
            {spots
                .map(spot => <Spot
                        spot={spot}
                        alerts={alerts}
                        hovered_spot={hovered_spot}
                        set_hovered_spot={set_hovered_spot}
                        on_spot_click={on_spot_click}
                    ></Spot>
                )}
        </tbody>
    </table>;
}

export default SpotsTable;

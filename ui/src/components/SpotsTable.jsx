import X from "@/components/X.jsx";
import { useEffect, forwardRef, useRef } from "react";

import { get_flag } from "@/flags.js";
import { useColors } from "../hooks/useColors";

const cell_classes = {
    time: "w-14",
    flag: "w-[1.3rem] md:min-w-[1.3rem]",
    dx_callsign: "w-16 2xs:w-24",
    freq: "w-12",
    band: "w-12 hidden md:table-cell",
    spotter_callsign: "w-16 2xs:w-24",
    mode: "w-12 lg:w-[14rem]",
    comment: "w-[40rem] text-left hidden xl:table-cell",
};

function Callsign({ callsign }) {
    return (
        <a href={"https://www.qrz.com/db/" + callsign} target="_blank">
            {callsign}
        </a>
    );
}

function Spot(
    {
        spot,
        is_even,
        hovered_spot,
        pinned_spot,
        set_pinned_spot,
        set_hovered_spot,
        set_cat_to_spot,
    },
    ref,
) {
    const time = new Date(spot.time * 1000);
    const utc_hours = String(time.getUTCHours()).padStart(2, "0");
    const utc_minutes = String(time.getUTCMinutes()).padStart(2, "0");
    const formatted_time = utc_hours + ":" + utc_minutes;
    const is_pinned = spot.id == pinned_spot;
    const is_hovered = spot.id == hovered_spot.id || is_pinned;

    const { colors } = useColors();
    let row_classes;
    if (spot.is_alerted) {
        row_classes = "outline-2 outline outline-dashed outline-offset-[-2px]";
    }

    const color = colors.bands[spot.band];
    let background_color;
    if (is_hovered) {
        background_color = colors.light_bands[spot.band];
    } else if (is_even) {
        background_color = colors.table.odd_row;
    } else {
        background_color = colors.table.even_row;
    }

    const flag = get_flag(spot.dx_country);

    return (
        <tr
            ref={ref}
            style={{
                backgroundColor: background_color,
                outlineColor: spot.is_alerted ? color : "",
                color: is_even ? colors.table.even_text : colors.table.odd_text,
            }}
            className={row_classes + " h-7"}
            onMouseEnter={() => set_hovered_spot({ source: "table", id: spot.id })}
            onClick={() => set_pinned_spot(spot.id)}
        >
            <td className={cell_classes.time}>
                {is_pinned ? (
                    <X
                        size="16"
                        on_click={event => {
                            event.stopPropagation();
                            return set_pinned_spot(null);
                        }}
                    />
                ) : (
                    formatted_time
                )}
            </td>

            <td className={cell_classes.flag} title={spot.dx_country}>
                {flag ? (
                    <img className="m-auto" width="16" src={`data:image/webp;base64, ${flag}`} />
                ) : (
                    ""
                )}
            </td>
            <td className={cell_classes.dx_callsign + " font-semibold"}>
                <Callsign callsign={spot.dx_callsign}></Callsign>
            </td>
            <td className={cell_classes.freq}>
                <div
                    onClick={() => set_cat_to_spot(spot)}
                    className="px-1 rounded-full cursor-pointer"
                    style={{
                        backgroundColor: `${window.matchMedia("(max-width: 767px)").matches ? color : "transparent"}`,
                        color: `${window.matchMedia("(max-width: 767px)").matches ? colors.text[spot.band] : ""}`,
                    }}
                >
                    {spot.freq}
                </div>
            </td>
            <td className={cell_classes.band + " flex justify-center items-center"}>
                <p
                    className="px-1 rounded-full font-medium"
                    style={{
                        backgroundColor: color,
                        color: colors.text[spot.band],
                    }}
                >
                    {spot.band}
                </p>
            </td>
            <td className={cell_classes.spotter_callsign}>
                <Callsign callsign={spot.spotter_callsign}></Callsign>
            </td>
            <td className={cell_classes.mode}>{spot.mode}</td>
            <td className={cell_classes.comment}>
                {spot.comment.replace(/&lt;/g, "<").replace(/&gt;/g, ">")}
            </td>
        </tr>
    );
}

Spot = forwardRef(Spot);

function HeaderCell({ title, field, cell_classes, table_sort, set_table_sort }) {
    let direction = "";
    if (table_sort.column == field) {
        if (table_sort.ascending) {
            direction = "⬇";
        } else {
            direction = "⬆";
        }
    }
    function set_sort() {
        if (table_sort.column == field) {
            set_table_sort({...table_sort, ascending: !table_sort.ascending});
        } else {
            set_table_sort({column: field, ascending: false});
        }
    }
    return <td className={cell_classes[field]} onClick={set_sort}>
        {direction}
        {title}
    </td>;
}

function SpotsTable({
    spots,
    hovered_spot,
    set_hovered_spot,
    pinned_spot,
    set_pinned_spot,
    set_cat_to_spot,
    table_sort,
    set_table_sort,
}) {
    const row_refs = useRef({});
    const { colors } = useColors();

    useEffect(() => {
        const hovered_ref = row_refs.current[hovered_spot.id];

        if (hovered_ref != undefined && hovered_spot.source == "map" && pinned_spot == undefined) {
            hovered_ref.scrollIntoView({ block: "center", behavior: "instant" });
        }
    }, [hovered_spot]);

    return (
        <div
            className="text-sm h-full overflow-x-visible border-x-4"
            style={{
                borderColor: colors.theme.borders,
                backgroundColor: colors.theme.background,
            }}
        >
            <div className="overflow-y-scroll h-full w-full">
                <table
                    className="max-md:table-fixed max-md:w-full text-center border-collapse"
                    onMouseLeave={_ => set_hovered_spot({ source: null, id: null })}
                >
                    <tbody className="divide-y">
                        <tr
                            className="sticky top-0"
                            style={{
                                backgroundColor: colors.table.header,
                                color: colors.table.header_text,
                            }}
                        >
                            <HeaderCell
                                title="Time"
                                field="time"
                                cell_classes={cell_classes}
                                table_sort={table_sort}
                                set_table_sort={set_table_sort}
                            />
                            <td className={cell_classes.flag}></td>
                            <HeaderCell
                                title="DX"
                                field="dx_callsign"
                                cell_classes={cell_classes}
                                table_sort={table_sort}
                                set_table_sort={set_table_sort}
                            />
                            <HeaderCell
                                title="Freq"
                                field="freq"
                                cell_classes={cell_classes}
                                table_sort={table_sort}
                                set_table_sort={set_table_sort}
                            />
                            <HeaderCell
                                title="Band"
                                field="band"
                                cell_classes={cell_classes}
                                table_sort={table_sort}
                                set_table_sort={set_table_sort}
                            />
                            <HeaderCell
                                title="Spotter"
                                field="spotter_callsign"
                                cell_classes={cell_classes}
                                table_sort={table_sort}
                                set_table_sort={set_table_sort}
                            />
                            <HeaderCell
                                title="Mode"
                                field="mode"
                                cell_classes={cell_classes}
                                table_sort={table_sort}
                                set_table_sort={set_table_sort}
                            />
                            <td className={cell_classes.comment}>Comment</td>
                        </tr>
                        {spots.map((spot, index) => (
                            <Spot
                                ref={element => (row_refs.current[spot.id] = element)}
                                key={spot.id}
                                spot={spot}
                                is_even={index % 2 == 0}
                                hovered_spot={hovered_spot}
                                pinned_spot={pinned_spot}
                                set_pinned_spot={set_pinned_spot}
                                set_hovered_spot={set_hovered_spot}
                                set_cat_to_spot={set_cat_to_spot}
                            ></Spot>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default SpotsTable;

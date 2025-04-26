import X from "@/components/X.jsx";
import { useEffect, useState, forwardRef, useRef } from "react";
import { createPortal } from "react-dom";

import { get_flag } from "@/flags.js";
import { useColors } from "@/hooks/useColors";
import { useServerData } from "@/hooks/useServerData";

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

function Popup({ anchor_ref, children }) {
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const popupRef = useRef(null);

    useEffect(() => {
        const anchor = anchor_ref.current;
        if (!anchor) {
            return;
        }

        const rect = anchor.getBoundingClientRect();
        const popup_width = popupRef.current?.offsetWidth || 0;

        setPosition({
            top: rect.top + window.scrollY - 24,
            left: rect.left + rect.width / 2 + window.scrollX - popup_width / 2,
        });
    }, [anchor_ref]);

    return createPortal(
        <div
            ref={popupRef}
            className="absolute z-50 p-0"
            style={{ top: position.top, left: position.left }}
        >
            {children}
        </div>,
        document.body,
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
        settings,
        same_freq_spots,
    },
    ref,
) {
    const time = new Date(spot.time * 1000);
    const utc_hours = String(time.getUTCHours()).padStart(2, "0");
    const utc_minutes = String(time.getUTCMinutes()).padStart(2, "0");
    const formatted_time = utc_hours + ":" + utc_minutes;
    const is_same_freq = same_freq_spots.includes(spot.id);
    const is_pinned = spot.id == pinned_spot;
    const is_hovered = spot.id == hovered_spot.id || is_pinned || is_same_freq;

    const { colors } = useColors();
    let row_classes;
    if (spot.is_alerted) {
        row_classes = "outline-4 outline outline-dashed outline-offset-[-2px] border-white";
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

    const [is_flag_hovered, set_is_flag_hovered] = useState(false);

    let dx_column;
    if (settings.show_flags) {
        const flag = get_flag(spot.dx_country);
        dx_column = flag ? (
            <img className="m-auto" width="16" src={`data:image/webp;base64, ${flag}`} />
        ) : (
            ""
        );
    } else {
        dx_column = <small className="leading-none">{spot.dx_country}</small>;
    }

    let popup_anchor = useRef(null);

    return (
        <tr
            ref={ref}
            style={{
                backgroundColor: background_color,
                outlineColor: spot.is_alerted ? colors.light_bands[spot.band] : "",
                border: spot.is_alerted ? "3px solid white" : "",
                color: is_even ? colors.table.even_text : colors.table.odd_text,
            }}
            className={row_classes + " h-7"}
            onMouseEnter={() => set_hovered_spot({ source: "table", id: spot.id })}
            onClick={() => set_pinned_spot(spot.id)}
        >
            <td className={cell_classes.time}>
                {is_pinned ? (
                    <div className="m-auto w-fit">
                        <X
                            size="16"
                            on_click={event => {
                                event.stopPropagation();
                                return set_pinned_spot(null);
                            }}
                        />
                    </div>
                ) : (
                    formatted_time
                )}
            </td>

            <td className={cell_classes.flag}>
                <div className="relative">
                    <div
                        ref={popup_anchor}
                        onMouseEnter={_ => set_is_flag_hovered(true)}
                        onMouseLeave={_ => set_is_flag_hovered(false)}
                    >
                        {dx_column}{" "}
                    </div>
                    {is_flag_hovered && settings.show_flags ? (
                        <Popup anchor_ref={popup_anchor}>
                            <div
                                className="py-0 px-2 h-[24px] whitespace-nowrap rounded shadow-lg"
                                style={{
                                    color: colors.theme.text,
                                    background: colors.theme.background,
                                }}
                            >
                                {spot.dx_country}
                            </div>
                        </Popup>
                    ) : (
                        ""
                    )}
                </div>
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
    let direction = " ";
    if (table_sort.column == field) {
        if (table_sort.ascending) {
            direction = "🠯";
        } else {
            direction = "🠭";
        }
    }
    function set_sort() {
        if (table_sort.column == field) {
            set_table_sort({ ...table_sort, ascending: !table_sort.ascending });
        } else {
            set_table_sort({ column: field, ascending: false });
        }
    }
    return (
        <td className={"cursor-pointer " + cell_classes[field]} onClick={set_sort}>
            <span className="font-bold text-lg leading-3">{direction}</span>
            {title}
        </td>
    );
}

function SpotsTable({ table_sort, settings, set_table_sort, set_cat_to_spot }) {
    const row_refs = useRef({});
    const { colors } = useColors();
    const { spots, hovered_spot, set_hovered_spot, pinned_spot, set_pinned_spot, freq_spots } =
        useServerData();

    useEffect(() => {
        const hovered_ref = row_refs.current[hovered_spot.id];

        if (
            hovered_ref != undefined &&
            ["map", "bar"].includes(hovered_spot.source) &&
            pinned_spot == undefined
        ) {
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
                                settings={settings}
                                same_freq_spots={freq_spots}
                            ></Spot>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default SpotsTable;

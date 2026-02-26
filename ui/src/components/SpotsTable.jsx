import X from "@/components/ui/X.jsx";
import { useEffect, useState, forwardRef, useRef } from "react";
import SpotContextMenu from "./SpotContextMenu";
import Popup from "./ui/Popup";
import CallsignSearch from "@/components/CallsignSearch.jsx";

import { get_flag } from "@/data/flags.js";
import { US_STATES } from "@/data/us_states.js";
import { useColors } from "@/hooks/useColors";
import { useSpotData } from "@/hooks/useSpotData";
import { useSpotInteraction } from "@/hooks/useSpotInteraction";
import { useFilters } from "@/hooks/useFilters";
import { useSettings } from "@/hooks/useSettings";

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
        on_context_menu,
        is_new_spot,
    },
    ref,
) {
    const { current_freq_spots } = useSpotData();
    const { settings } = useSettings();
    const [is_fading, set_is_fading] = useState(false);

    useEffect(() => {
        if (is_new_spot) {
            set_is_fading(false);

            const timer = setTimeout(() => {
                set_is_fading(true);
            }, 100);
            return () => clearTimeout(timer);
        } else {
            set_is_fading(false);
        }
    }, [is_new_spot]);

    const time = new Date(spot.time * 1000);
    const utc_hours = String(time.getUTCHours()).padStart(2, "0");
    const utc_minutes = String(time.getUTCMinutes()).padStart(2, "0");
    const formatted_time = utc_hours + ":" + utc_minutes;
    const is_same_freq = current_freq_spots.includes(spot.id);
    const is_pinned = spot.id == pinned_spot;
    const is_hovered = spot.id == hovered_spot.id || is_pinned || is_same_freq;

    const { colors, dev_mode } = useColors();
    let row_classes;

    const is_regular_alerted = spot.is_alerted && !spot.is_dxpedition;
    const is_dxpedition_alerted = spot.is_alerted && spot.is_dxpedition;

    if (is_regular_alerted) {
        row_classes = "outline-4 outline outline-dashed outline-offset-[-2px] border-white";
    }

    const color = colors.bands[spot.band];
    let background_color;
    let text_color;

    let normal_bg_color, normal_text_color;
    if (is_even) {
        normal_bg_color = colors.table.odd_row;
        normal_text_color = colors.table.even_text;
    } else {
        normal_bg_color = colors.table.even_row;
        normal_text_color = colors.table.odd_text;
    }

    if (is_hovered) {
        background_color = colors.light_bands[spot.band];
        text_color = colors.text[spot.band];
    } else if (is_new_spot && !is_fading) {
        background_color = colors.light_bands[spot.band];
        text_color = colors.text[spot.band];
    } else {
        background_color = normal_bg_color;
        text_color = normal_text_color;
    }

    const [is_flag_hovered, set_is_flag_hovered] = useState(false);

    let dx_column;
    let dx_state;
    if (
        settings.show_state_abbreviations &&
        spot.dx_state &&
        (spot.dx_country == "USA" || dev_mode)
    ) {
        dx_state = `(${spot.dx_state})`;
    } else {
        dx_state = "";
    }
    if (settings.show_flags) {
        const flag = get_flag(spot.dx_country);
        dx_column = flag ? (
            <>
                <img className="m-auto" width="16" src={`data:image/webp;base64, ${flag}`} />
                {dx_state}
            </>
        ) : (
            ""
        );
    } else {
        dx_column = (
            <small className="leading-none">
                {spot.dx_country} {dx_state}
            </small>
        );
    }

    let popup_anchor = useRef(null);

    return (
        <tr
            ref={ref}
            style={{
                backgroundColor: background_color,
                outlineColor: is_regular_alerted ? colors.light_bands[spot.band] : "",
                border: is_regular_alerted ? `3px solid ${colors.spots.alert_border}` : "",
                color: text_color,
                transition: is_new_spot
                    ? "background-color 2.5s ease-out, color 2.5s ease-out"
                    : "none",
            }}
            className={row_classes + " h-7 z-40"}
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

            <td
                onContextMenu={event => {
                    event.preventDefault();
                    on_context_menu(event, spot, "flag");
                }}
                className={cell_classes.flag}
            >
                <div
                    className="relative cursor-pointer"
                    ref={popup_anchor}
                    onMouseEnter={_ => set_is_flag_hovered(true)}
                    onMouseLeave={_ => set_is_flag_hovered(false)}
                >
                    {dx_column}
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
                            {spot.dx_state && spot.dx_country === "USA" && US_STATES[spot.dx_state]
                                ? `, ${US_STATES[spot.dx_state]}`
                                : ""}
                        </div>
                    </Popup>
                ) : (
                    ""
                )}
            </td>
            <td
                className={cell_classes.dx_callsign + " font-semibold"}
                style={{
                    outline: is_dxpedition_alerted
                        ? `2px solid ${colors.spots.dxpedition_alert}`
                        : "none",
                    outlineOffset: "-3px",
                    padding: "4px",
                }}
                onContextMenu={event => {
                    event.preventDefault();
                    on_context_menu(event, spot, "callsign", false);
                }}
            >
                <Callsign callsign={spot.dx_callsign} />
                {is_dxpedition_alerted && (
                    <span className="ml-1" title="DXpedition">
                        ⭐
                    </span>
                )}
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
            <td
                className={cell_classes.spotter_callsign}
                onContextMenu={event => {
                    event.preventDefault();
                    on_context_menu(event, spot, "callsign", true);
                }}
            >
                <Callsign callsign={spot.spotter_callsign} />
            </td>
            <td className={cell_classes.mode}>{spot.mode}</td>
            <td className={cell_classes.comment}>
                {spot.comment.replace(/&lt;/g, "<").replace(/&gt;/g, ">")}
            </td>
        </tr>
    );
}

Spot = forwardRef(Spot);

function update_parity_map(parity, prev_sort, table_sort, spots) {
    if (
        prev_sort.current.column !== table_sort.column ||
        prev_sort.current.ascending !== table_sort.ascending
    ) {
        parity.clear();
        prev_sort.current = table_sort;
    }

    const current_ids = new Set(spots.map(s => s.id));
    for (const id of parity.keys()) {
        if (!current_ids.has(id)) parity.delete(id);
    }

    for (let i = 0; i < spots.length; i++) {
        const id = spots[i].id;
        if (!parity.has(id)) {
            if (i > 0) {
                parity.set(id, !parity.get(spots[i - 1].id));
            } else if (spots.length > 1 && parity.has(spots[1].id)) {
                parity.set(id, !parity.get(spots[1].id));
            } else {
                parity.set(id, true);
            }
        }
    }
}

function HeaderCell({ title, field, cell_classes, table_sort, set_table_sort, sorting = true }) {
    const { colors } = useColors();
    let direction = <span className="w-[0.8em] h-[1.5em]"></span>;
    if (table_sort.column == field && sorting) {
        if (table_sort.ascending) {
            direction = (
                <svg className="w-[0.8em] h-[1.5em]" viewBox="0 0 16 16" fill="none">
                    <path
                        d="M10 8L14 8V10L8 16L2 10V8H6V0L10 4.76995e-08V8Z"
                        fill={colors.table.header_arrow}
                    />
                </svg>
            );
        } else {
            direction = (
                <svg className="w-[0.8em] h-[1.5em]" viewBox="0 0 16 16" fill="none">
                    <path
                        d="M6 8L2 8L2 6L8 5.24536e-07L14 6L14 8L10 8L10 16L6 16L6 8Z"
                        fill={colors.table.header_arrow}
                    />
                </svg>
            );
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
        <td
            className={
                "sticky top-0 z-40 h-8 " + (sorting ? "cursor-pointer " : "") + cell_classes[field]
            }
            style={{
                backgroundColor: colors.table.header,
                color: colors.table.header_text,
                borderBottom: `2px solid ${colors.table.header_arrow}`,
            }}
            onClick={() => (sorting ? set_sort() : "")}
        >
            <div className="flex justify-center items-center h-full font-bold">
                {direction}
                <span>{title}</span>
            </div>
        </td>
    );
}

function SpotsTable({ table_sort, set_table_sort, set_cat_to_spot }) {
    const { colors } = useColors();
    const { spots, new_spot_ids, current_freq_spots } = useSpotData();
    const { hovered_spot, set_hovered_spot, pinned_spot, set_pinned_spot } = useSpotInteraction();
    const { callsign_filters, setCallsignFilters } = useFilters();
    const row_refs = useRef({});

    const parity_map = useRef(new Map());
    const prev_sort = useRef(table_sort);
    update_parity_map(parity_map.current, prev_sort, table_sort, spots);

    const [context_menu, set_context_menu] = useState({
        visible: false,
        x: 0,
        y: 0,
        spot: null,
        is_spotter: false,
        menu_type: "callsign",
    });

    const get_context_menu_actions = menu_type => {
        if (menu_type === "flag") {
            return [
                {
                    label: spot => `Create Alert for ${spot.dx_country}`,
                    onClick: spot => {
                        add_filter({
                            action: "alert",
                            type: "entity",
                            value: spot.dx_country,
                            spotter_or_dx: "dx",
                        });
                    },
                },
                {
                    label: spot => `Show Only ${spot.dx_country}`,
                    onClick: spot => {
                        add_filter({
                            action: "show_only",
                            type: "entity",
                            value: spot.dx_country,
                            spotter_or_dx: "dx",
                        });
                    },
                },
                {
                    label: spot => `Hide ${spot.dx_country}`,
                    onClick: spot => {
                        add_filter({
                            action: "hide",
                            type: "entity",
                            value: spot.dx_country,
                            spotter_or_dx: "dx",
                        });
                    },
                },
            ];
        } else {
            return [
                {
                    label: spot => "Open QRZ Profile",
                    onClick: spot => {
                        const callsign = context_menu.is_spotter
                            ? spot.spotter_callsign
                            : spot.dx_callsign;
                        window.open(`https://www.qrz.com/db/${callsign}`, "_blank");
                    },
                },
                {
                    label: spot => (spot.id == pinned_spot ? "Unpin Spot" : "Pin Spot"),
                    onClick: spot => {
                        set_pinned_spot(spot.id === pinned_spot ? null : spot.id);
                    },
                },
                {
                    label: spot => "Create Alert",
                    onClick: spot => {
                        const is_spotter = context_menu.is_spotter;
                        add_filter({
                            action: "alert",
                            type: "prefix",
                            value: is_spotter ? spot.spotter_callsign : spot.dx_callsign,
                            spotter_or_dx: is_spotter ? "spotter" : "dx",
                        });
                    },
                },
                {
                    label: spot => "Create Show Only Filter",
                    onClick: spot => {
                        const is_spotter = context_menu.is_spotter;
                        add_filter({
                            action: "show_only",
                            type: "prefix",
                            value: is_spotter ? spot.spotter_callsign : spot.dx_callsign,
                            spotter_or_dx: is_spotter ? "spotter" : "dx",
                        });
                    },
                },
                {
                    label: spot => "Create Hide Filter",
                    onClick: spot => {
                        const is_spotter = context_menu.is_spotter;
                        add_filter({
                            action: "hide",
                            type: "prefix",
                            value: is_spotter ? spot.spotter_callsign : spot.dx_callsign,
                            spotter_or_dx: is_spotter ? "spotter" : "dx",
                        });
                    },
                },
            ];
        }
    };

    const handle_context_menu = (event, spot, menu_type, is_spotter = false) => {
        event.preventDefault();
        const x = event.clientX;
        const y = event.clientY;

        const menuWidth = 200;
        const actions = get_context_menu_actions(menu_type);
        const menuHeight = actions.length * 43;
        const adjustedX = Math.min(x, window.innerWidth - menuWidth);
        const adjustedY = Math.min(y, window.innerHeight - menuHeight);

        set_context_menu({
            visible: true,
            x: adjustedX,
            y: adjustedY,
            spot,
            is_spotter,
            menu_type,
        });
    };

    const add_filter = filter => {
        setCallsignFilters({
            ...callsign_filters,
            filters: [...callsign_filters.filters, filter],
        });
    };

    useEffect(() => {
        const hovered_ref = row_refs.current[hovered_spot.id];

        if (
            hovered_ref != undefined &&
            ["spotter", "dx", "arc", "bar", "dxpedition"].includes(hovered_spot.source) &&
            pinned_spot == undefined
        ) {
            hovered_ref.scrollIntoView({ block: "center", behavior: "instant" });
        }
    }, [hovered_spot]);

    return (
        <>
            <div
                className="relative text-sm h-full overflow-x-visible border-x-4 flex flex-col"
                style={{
                    borderColor: colors.theme.borders,
                    backgroundColor: colors.theme.background,
                }}
            >
                <CallsignSearch />
                <div className="overflow-y-scroll h-full w-full">
                    <table
                        className="max-md:table-fixed max-md:w-full text-center border-separate border-spacing-0"
                        onMouseLeave={_ => set_hovered_spot({ source: null, id: null })}
                    >
                        <tbody className="divide-y">
                            <tr>
                                <HeaderCell
                                    title="Time"
                                    field="time"
                                    cell_classes={cell_classes}
                                    table_sort={table_sort}
                                    set_table_sort={set_table_sort}
                                />
                                <HeaderCell
                                    title=""
                                    field="flag"
                                    cell_classes={cell_classes}
                                    table_sort={table_sort}
                                    set_table_sort={set_table_sort}
                                    sorting={false}
                                />
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
                                <HeaderCell
                                    title="Comment"
                                    field="comment"
                                    cell_classes={cell_classes}
                                    table_sort={table_sort}
                                    set_table_sort={set_table_sort}
                                    sorting={false}
                                />
                            </tr>
                            {spots.map(spot => (
                                <Spot
                                    ref={element => (row_refs.current[spot.id] = element)}
                                    key={spot.id}
                                    spot={spot}
                                    is_even={parity_map.current.get(spot.id)}
                                    hovered_spot={hovered_spot}
                                    pinned_spot={pinned_spot}
                                    set_pinned_spot={set_pinned_spot}
                                    set_hovered_spot={set_hovered_spot}
                                    set_cat_to_spot={set_cat_to_spot}
                                    on_context_menu={handle_context_menu}
                                    is_new_spot={new_spot_ids.has(spot.id)}
                                ></Spot>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            {context_menu.visible && (
                <SpotContextMenu
                    x={context_menu.x}
                    y={context_menu.y}
                    spot={context_menu.spot}
                    is_spotter={context_menu.is_spotter}
                    on_close={() => set_context_menu({ ...context_menu, visible: false })}
                    actions={get_context_menu_actions(context_menu.menu_type)}
                />
            )}
        </>
    );
}

export default SpotsTable;

import { useState, useEffect } from "react";
import { get_base_url } from "@/utils.js";
import FilterOptions from "@/components/FilterOptions.jsx";
import FilterButton from "@/components/FilterButton.jsx";
import { bands, modes } from "@/filters_data.js";
import { useServerData } from "@/hooks/useServerData";
import { useFilters } from "@/hooks/useFilters";
import { useColors } from "@/hooks/useColors";
import { useSettings } from "@/hooks/useSettings";
import use_radio from "../hooks/useRadio";

function Hex(color) {
    return (
        <svg width="16" height="16" viewBox="0 0 256 256">
            <path
                fill={color}
                d="M228,80.668V175.332a16.0255,16.0255,0,0,1-8.12695,13.9292l-84,47.47852a16.08782,16.08782,0,0,1-15.7461,0l-84-47.478A16.02688,16.02688,0,0,1,28,175.332V80.668a16.0255,16.0255,0,0,1,8.127-13.9292l84-47.47852a16.08654,16.08654,0,0,1,15.7461,0l84,47.478A16.02688,16.02688,0,0,1,228,80.668Z"
            />
        </svg>
    );
}

function Triangle(color) {
    return (
        <svg width="16" height="16" viewBox="0 0 512 512">
            <g stroke="none" strokeWidth="1" fill="none" fillRule="evenodd">
                <g id="drop" fill={color} transform="translate(32.000000, 42.666667)">
                    <path d="M246.312928,5.62892705 C252.927596,9.40873724 258.409564,14.8907053 262.189374,21.5053731 L444.667042,340.84129 C456.358134,361.300701 449.250007,387.363834 428.790595,399.054926 C422.34376,402.738832 415.04715,404.676552 407.622001,404.676552 L42.6666667,404.676552 C19.1025173,404.676552 7.10542736e-15,385.574034 7.10542736e-15,362.009885 C7.10542736e-15,354.584736 1.93772021,347.288125 5.62162594,340.84129 L188.099293,21.5053731 C199.790385,1.04596203 225.853517,-6.06216498 246.312928,5.62892705 Z" />
                </g>
            </g>
        </svg>
    );
}

function Square(color) {
    return (
        <svg className="ml-1" width="12" height="12" viewBox="0 0 16 16">
            <rect fill={color} width="100" height="100" />
        </svg>
    );
}

const mode_to_symbol = {
    SSB: Square,
    CW: Triangle,
    FT8: Hex,
    FT4: Hex,
    DIGI: Hex,
};

function SpotCount({ count }) {
    if (count === 0) return null;

    const classes = [
        "relative",
        "inline-flex",
        "border",
        "border-gray-900",
        "bg-red-600",
        "text-white",
        "font-medium",
        "justify-center",
        "items-center",
        "rounded-full",
        "h-5",
        "w-5",
        "text-center",
        "text-[12px]",
    ];

    return (
        <span className="absolute left-12 flex w-5 -translate-y-1 translate-x-1 z-10">
            <span className={classes.join(" ")}>{count}</span>
        </span>
    );
}

function LeftColumn({ toggled_ui }) {
    const { spots_per_band_count, spots_per_mode_count, set_hovered_band } = useServerData();
    const { filters, setFilters, setRadioModeFilter } = useFilters();
    const { radio_band, radio_status } = use_radio();
    const { settings } = useSettings();

    const filter_group_classes = "p-1 flex flex-col text-center gap-2 ";
    const toggled_classes = toggled_ui.left
        ? "hidden "
        : "max-2xl:absolute max-2xl:flex z-50 border-r border-slate-300 ";

    const { colors } = useColors();

    const visible_bands = bands.filter(band => {
        if (settings.show_disabled_bands) {
            return true;
        }
        return !settings.disabled_bands[band];
    });

    return (
        <div
            className={toggled_classes + "2xl:flex w-16 flex-col h-full items-center"}
            style={{
                backgroundColor: colors.theme.columns,
                borderColor: colors.theme.borders,
            }}
        >
            <div className={filter_group_classes + "pb-4 border-b-2 border-slate-300"}>
                {visible_bands.map(band => {
                    const color = colors.bands[band];
                    let label = Number.isInteger(band) ? band + "m" : band;
                    return (
                        <FilterOptions
                            key={band}
                            filter_key="bands"
                            filter_value={band}
                            orientation="right"
                            disabled={filters.radio_band}
                        >
                            {!filters.radio_band && (
                                <SpotCount count={spots_per_band_count[band]} />
                            )}
                            <FilterButton
                                text={label}
                                is_active={filters.bands[band]}
                                color={color}
                                text_color={colors.text[band]}
                                on_click={_ => {
                                    if (!filters.radio_band)
                                        setFilters(_filters => ({
                                            ..._filters,
                                            bands: {
                                                ..._filters.bands,
                                                [band]: !_filters.bands[band],
                                            },
                                        }));
                                }}
                                className={filters.radio_band && "opacity-50"}
                                on_mouse_enter={_ => {
                                    if (!filters.radio_band) set_hovered_band(band);
                                }}
                                on_mouse_leave={_ => set_hovered_band(null)}
                                hover_brightness="125"
                            />
                        </FilterOptions>
                    );
                })}
            </div>

            {radio_status != "unavailable" || filters.radio_band ? (
                <div className={filter_group_classes + "py-4 border-b-2 border-slate-300"}>
                    <div>
                        <SpotCount count={spots_per_band_count[radio_band]} />
                        <FilterButton
                            text={"Radio"}
                            is_active={filters.radio_band}
                            color={colors.bands[radio_band] ?? "black"}
                            text_color={colors.text[radio_band] ?? "white"}
                            on_click={_ => setRadioModeFilter(!filters.radio_band)}
                            hover_brightness="125"
                        />
                    </div>
                </div>
            ) : (
                ""
            )}

            <div className={filter_group_classes + " pt-4"}>
                {modes.map(mode => {
                    return (
                        <FilterOptions
                            key={mode}
                            filter_key="modes"
                            filter_value={mode}
                            orientation="right"
                        >
                            <SpotCount count={spots_per_mode_count[mode]} />
                            <FilterButton
                                text={
                                    <>
                                        {mode}
                                        <div className="ml-1">
                                            {mode_to_symbol[mode](
                                                filters.modes[mode]
                                                    ? "#000000"
                                                    : colors.buttons.disabled,
                                            )}
                                        </div>
                                    </>
                                }
                                is_active={filters.modes[mode]}
                                on_click={() =>
                                    setFilters(_filters => ({
                                        ..._filters,
                                        modes: {
                                            ..._filters.modes,
                                            [mode]: !_filters.modes[mode],
                                        },
                                    }))
                                }
                                color={colors.buttons.modes}
                            />
                        </FilterOptions>
                    );
                })}
            </div>
        </div>
    );
}

export default LeftColumn;

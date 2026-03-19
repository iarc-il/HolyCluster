import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import FilterOptions from "@/components/FilterOptions.jsx";
import FilterButton from "@/components/FilterButton.jsx";
import { bands, modes } from "@/data/filters_data.js";
import { get_mode_shape } from "@/data/mode_shapes.js";
import { useSpotData } from "@/hooks/useSpotData";
import { useSpotInteraction } from "@/hooks/useSpotInteraction";
import { useFilters } from "@/hooks/useFilters";
import { useColors } from "@/hooks/useColors";
import { useSettings } from "@/hooks/useSettings";
import use_radio from "@/hooks/useRadio";

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

const shape_to_symbol = {
    square: Square,
    triangle: Triangle,
    hexagon: Hex,
};

function mode_to_symbol(mode) {
    return shape_to_symbol[get_mode_shape(mode)];
}

function SpotCount({ count, toggled_ui, overlay_el }) {
    const anchor_ref = useRef(null);
    const badge_ref = useRef(null);

    const update_position = useCallback(() => {
        const anchor = anchor_ref.current;
        const badge = badge_ref.current;
        if (!anchor || !badge) return;

        const scroll_container = anchor.closest(".overflow-y-auto");
        if (!scroll_container) return;

        const anchor_rect = anchor.getBoundingClientRect();
        const container_rect = scroll_container.getBoundingClientRect();

        badge.style.top =
            anchor_rect.top - container_rect.top + scroll_container.scrollTop - 4 + "px";
        badge.style.left = anchor_rect.left - container_rect.left + 20 + "px";
    }, []);

    useEffect(() => {
        update_position();

        const scroll_container = anchor_ref.current?.closest(".overflow-y-auto");
        if (!scroll_container) return;

        window.addEventListener("resize", update_position);

        const observer = new MutationObserver(update_position);
        observer.observe(scroll_container, { childList: true, subtree: true });

        return () => {
            window.removeEventListener("resize", update_position);
            observer.disconnect();
        };
    }, [update_position, toggled_ui.left_visible, count]);

    const is_visible = toggled_ui.left_visible && count !== 0;

    return (
        <>
            <span ref={anchor_ref} className="absolute invisible" />
            {is_visible &&
                overlay_el &&
                createPortal(
                    <span ref={badge_ref} className="absolute flex w-5 pointer-events-none">
                        <span className="inline-flex border border-gray-900 bg-red-600 text-white font-medium justify-center items-center rounded-full h-5 w-5 text-[12px]">
                            {count}
                        </span>
                    </span>,
                    overlay_el,
                )}
        </>
    );
}

function use_scroll_sync(scroll_ref, overlay_el) {
    useEffect(() => {
        const scroll_el = scroll_ref.current;
        if (!scroll_el || !overlay_el) return;

        let animation = null;
        let animation_frame_id = null;
        const has_scroll_timeline = "ScrollTimeline" in window;

        function sync_animation() {
            if (animation) animation.cancel();
            animation = null;

            const maxScroll = scroll_el.scrollHeight - scroll_el.clientHeight;
            if (maxScroll <= 0) {
                overlay_el.style.transform = "";
                return;
            }

            try {
                animation = overlay_el.animate(
                    [{ transform: "translateY(0)" }, { transform: `translateY(${-maxScroll}px)` }],
                    {
                        fill: "both",
                        timeline: new ScrollTimeline({
                            source: scroll_el,
                            axis: "block",
                        }),
                    },
                );
            } catch {
                animation = null;
            }
        }

        if (has_scroll_timeline) sync_animation();

        const mutation_observer = new MutationObserver(() => {
            if (animation_frame_id) cancelAnimationFrame(animation_frame_id);
            animation_frame_id = requestAnimationFrame(() => {
                if (has_scroll_timeline) sync_animation();
                else overlay_el.style.transform = `translateY(${-scroll_el.scrollTop}px)`;
            });
        });
        mutation_observer.observe(scroll_el, { childList: true, subtree: true });

        function on_scroll() {
            overlay_el.style.transform = `translateY(${-scroll_el.scrollTop}px)`;
        }
        if (!has_scroll_timeline) {
            scroll_el.addEventListener("scroll", on_scroll, { passive: true });
        }

        function on_resize() {
            if (has_scroll_timeline) sync_animation();
        }
        window.addEventListener("resize", on_resize);

        return () => {
            if (animation) animation.cancel();
            if (animation_frame_id) cancelAnimationFrame(animation_frame_id);
            mutation_observer.disconnect();
            scroll_el.removeEventListener("scroll", on_scroll);
            window.removeEventListener("resize", on_resize);
        };
    }, [scroll_ref, overlay_el]);
}

function LeftColumn({ toggled_ui }) {
    const { spots_per_band_count, spots_per_mode_count } = useSpotData();
    const { set_hovered_band } = useSpotInteraction();
    const { filters, setFilters, setRadioModeFilter } = useFilters();
    const { radio_band, radio_status } = use_radio();
    const { settings } = useSettings();

    const scroll_ref = useRef(null);
    const [overlay_el, setOverlayEl] = useState(null);

    use_scroll_sync(scroll_ref, overlay_el);

    const filter_group_classes = "p-1 flex flex-col text-center gap-2 ";
    const toggled_classes = toggled_ui.left_visible
        ? "max-2xl:absolute max-2xl:flex z-50 border-r border-slate-300 "
        : "hidden ";

    const { colors } = useColors();

    const visible_bands = bands.filter(band => {
        if (settings.show_disabled_bands) {
            return true;
        }
        return !settings.disabled_bands[band];
    });

    return (
        <div
            className={toggled_classes + "2xl:flex w-18 flex-col h-full shrink-0 relative"}
            style={{
                backgroundColor: colors.theme.columns,
                borderColor: colors.theme.borders,
            }}
        >
            <div ref={scroll_ref} className="flex flex-col h-full items-center overflow-y-auto">
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
                                    <SpotCount
                                        count={spots_per_band_count[band]}
                                        toggled_ui={toggled_ui}
                                        overlay_el={overlay_el}
                                    />
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
                            <SpotCount
                                count={spots_per_band_count[radio_band]}
                                toggled_ui={toggled_ui}
                                overlay_el={overlay_el}
                            />
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
                                <SpotCount
                                    count={spots_per_mode_count[mode]}
                                    toggled_ui={toggled_ui}
                                    overlay_el={overlay_el}
                                />
                                <FilterButton
                                    text={
                                        <>
                                            {mode}
                                            <div>
                                                {mode_to_symbol(mode)(
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
                                    className="text-[0.94rem]"
                                />
                            </FilterOptions>
                        );
                    })}
                </div>
            </div>
            <div
                className="absolute inset-0 pointer-events-none z-50"
                style={{ overflowY: "clip", overflowX: "visible" }}
            >
                <div ref={setOverlayEl} />
            </div>
        </div>
    );
}

export default LeftColumn;

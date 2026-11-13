import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

import { TOUR_FILTER_OPTIONS_EVENT } from "@/components/tour/tour_events.js";
import Button from "@/components/ui/Button.jsx";
import { useColors } from "@/hooks/useColors";
import { useFilters } from "@/hooks/useFilters";
import { useSettings } from "@/hooks/useSettings";

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 10;

function FilterOptions({
    touch = false,
    filter_key,
    filter_value,
    orientation,
    disabled,
    on_only_click,
    children,
}) {
    const { setFilterKeys, setOnlyFilterKeys } = useFilters();
    const { colors } = useColors();
    const { settings } = useSettings();

    const [is_parent_hovered, set_is_parent_hovered] = useState(false);
    const [is_popup_hovered, set_is_popup_hovered] = useState(false);
    const [is_tour_open, set_is_tour_open] = useState(false);
    const [is_touch_open, set_is_touch_open] = useState(false);
    const trigger_ref = useRef(null);
    const popup_ref = useRef(null);
    const long_press_timer_ref = useRef(null);
    const long_press_start_ref = useRef(null);
    const suppress_click_ref = useRef(false);
    const touch_pointer_ref = useRef(false);
    const [position, set_position] = useState(null);

    const is_open = is_parent_hovered || is_popup_hovered || is_tour_open || is_touch_open;
    const disabled_filter_by_key = {
        bands: settings.disabled_bands,
        modes: settings.disabled_modes,
    };
    const disabled_filters = disabled_filter_by_key[filter_key] || {};

    function clear_long_press() {
        if (long_press_timer_ref.current != null) {
            window.clearTimeout(long_press_timer_ref.current);
            long_press_timer_ref.current = null;
        }
        long_press_start_ref.current = null;
    }

    function close_popup() {
        set_is_parent_hovered(false);
        set_is_popup_hovered(false);
        set_is_tour_open(false);
        set_is_touch_open(false);
    }

    function handle_pointer_down(event) {
        touch_pointer_ref.current = event.pointerType === "touch";
        if ((!touch && !touch_pointer_ref.current) || disabled || event.button !== 0) return;

        suppress_click_ref.current = false;
        clear_long_press();
        long_press_start_ref.current = { x: event.clientX, y: event.clientY };
        long_press_timer_ref.current = window.setTimeout(() => {
            suppress_click_ref.current = true;
            set_is_touch_open(true);
            long_press_timer_ref.current = null;
        }, LONG_PRESS_MS);
    }

    function handle_pointer_move(event) {
        const start = long_press_start_ref.current;
        if (
            start == null ||
            Math.hypot(event.clientX - start.x, event.clientY - start.y) <=
                LONG_PRESS_MOVE_TOLERANCE
        ) {
            return;
        }
        clear_long_press();
    }

    function handle_click_capture(event) {
        if (!suppress_click_ref.current) return;

        event.preventDefault();
        event.stopPropagation();
        suppress_click_ref.current = false;
    }

    function handle_middle_click(event) {
        if (event.button !== 1 || disabled || event.target?.closest?.("button") == null) {
            return;
        }

        event.preventDefault();
        setOnlyFilterKeys(filter_key, filter_value);
        on_only_click?.(filter_value);
        close_popup();
    }

    useEffect(() => {
        if (is_open && trigger_ref.current) {
            const rect = trigger_ref.current.getBoundingClientRect();

            if (is_touch_open) {
                const popup_width = 89.6;
                const popup_height = 112;
                const left = Math.min(
                    Math.max(8, rect.left + rect.width / 2 - popup_width / 2),
                    window.innerWidth - popup_width - 8,
                );
                const top =
                    rect.bottom + popup_height + 8 <= window.innerHeight
                        ? rect.bottom + 8
                        : Math.max(8, rect.top - popup_height - 8);
                set_position({ top, left });
                return;
            }

            const top = rect.top - rect.height * 1.5;
            const left = orientation === "right" ? rect.right : rect.left - rect.width * 1.4;

            set_position({ top, left });
        }
    }, [is_open, is_touch_open, orientation]);

    useEffect(() => {
        return clear_long_press;
    }, []);

    useEffect(() => {
        if (!is_touch_open) return;

        function close_on_outside_pointer(event) {
            if (
                trigger_ref.current?.contains(event.target) ||
                popup_ref.current?.contains(event.target)
            ) {
                return;
            }
            close_popup();
        }

        function close_on_escape(event) {
            if (event.key === "Escape") close_popup();
        }

        document.addEventListener("pointerdown", close_on_outside_pointer);
        document.addEventListener("keydown", close_on_escape);
        return () => {
            document.removeEventListener("pointerdown", close_on_outside_pointer);
            document.removeEventListener("keydown", close_on_escape);
        };
    }, [is_touch_open]);

    useEffect(() => {
        function handle_tour_filter_options(event) {
            const detail = event.detail ?? {};
            const is_match =
                detail.filter_key === filter_key && detail.filter_value === filter_value;

            if (detail.open && is_match) {
                set_is_tour_open(true);
            } else if (!detail.open) {
                set_is_tour_open(false);
            }
        }

        document.addEventListener(TOUR_FILTER_OPTIONS_EVENT, handle_tour_filter_options);
        return () =>
            document.removeEventListener(TOUR_FILTER_OPTIONS_EVENT, handle_tour_filter_options);
    }, [filter_key, filter_value]);

    return (
        <div
            ref={trigger_ref}
            className="relative"
            data-tour={`filter-options-trigger-${filter_key}-${filter_value}`}
            onMouseEnter={() => {
                if (!disabled && !touch && !touch_pointer_ref.current) {
                    set_is_parent_hovered(true);
                }
            }}
            onMouseLeave={() => set_is_parent_hovered(false)}
            onAuxClick={handle_middle_click}
            onPointerDown={handle_pointer_down}
            onPointerMove={handle_pointer_move}
            onPointerUp={clear_long_press}
            onPointerCancel={clear_long_press}
            onClickCapture={handle_click_capture}
            onContextMenu={event => {
                if (touch || touch_pointer_ref.current) event.preventDefault();
            }}
        >
            {children}
            {is_open &&
                position &&
                createPortal(
                    <div
                        ref={popup_ref}
                        className={`fixed flex w-[5.6rem] flex-col z-[100] border border-gray-500 shadow-xl rounded-lg ${is_touch_open ? "p-2" : "p-3"}`}
                        data-tour="filter-options-popup"
                        data-tour-state={`${filter_key}-${filter_value}`}
                        style={{
                            backgroundColor: colors.theme.background,
                            top: position.top,
                            left: position.left,
                        }}
                        onMouseEnter={() => set_is_popup_hovered(true)}
                        onMouseLeave={() => set_is_popup_hovered(false)}
                    >
                        <div className={is_touch_open ? "space-y-2" : "space-y-4"}>
                            <Button
                                color="blue"
                                className={is_touch_open ? "min-h-10 w-full px-2" : "w-16 px-2"}
                                data-tour="filter-options-only"
                                on_click={() => {
                                    setOnlyFilterKeys(filter_key, filter_value);
                                    on_only_click?.(filter_value);
                                    close_popup();
                                }}
                            >
                                ONLY
                            </Button>
                            <Button
                                color="green"
                                className={is_touch_open ? "min-h-10 w-full px-2" : "w-16 px-2"}
                                data-tour="filter-options-all"
                                on_click={() => {
                                    setFilterKeys(filter_key, true, disabled_filters);
                                    close_popup();
                                }}
                            >
                                ALL
                            </Button>
                        </div>
                    </div>,
                    document.body,
                )}
        </div>
    );
}

export default FilterOptions;

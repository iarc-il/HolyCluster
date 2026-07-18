import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

import { TOUR_FILTER_OPTIONS_EVENT } from "@/components/tour/tour_events.js";
import Button from "@/components/ui/Button.jsx";
import { useColors } from "@/hooks/useColors";
import { useFilters } from "@/hooks/useFilters";
import { useSettings } from "@/hooks/useSettings";

function FilterOptions({
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
    const trigger_ref = useRef(null);
    const [position, set_position] = useState(null);

    const is_open = is_parent_hovered || is_popup_hovered || is_tour_open;
    const disabled_filter_by_key = {
        bands: settings.disabled_bands,
        modes: settings.disabled_modes,
    };
    const disabled_filters = disabled_filter_by_key[filter_key] || {};

    function close_popup() {
        set_is_parent_hovered(false);
        set_is_popup_hovered(false);
        set_is_tour_open(false);
    }

    useEffect(() => {
        if (is_open && trigger_ref.current) {
            const rect = trigger_ref.current.getBoundingClientRect();

            const top = rect.top - rect.height * 1.5;
            let left;

            if (orientation === "right") {
                left = rect.right;
            } else {
                left = rect.left - rect.width * 1.4;
            }

            set_position({ top, left });
        }
    }, [is_open, orientation]);

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
                if (!disabled) {
                    set_is_parent_hovered(true);
                }
            }}
            onMouseLeave={() => set_is_parent_hovered(false)}
        >
            {children}
            {is_open &&
                position &&
                createPortal(
                    <div
                        className="fixed flex flex-col z-[100] border border-gray-500 shadow-xl rounded-lg p-3 w-[5.6rem]"
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
                        <div className="space-y-4">
                            <Button
                                color="blue"
                                className="w-16 px-2"
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
                                className="w-16 px-2"
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

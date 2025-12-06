import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

import Button from "@/components/Button.jsx";
import { useFilters } from "../hooks/useFilters";
import { useColors } from "@/hooks/useColors";
import { useSettings } from "@/hooks/useSettings";

function FilterOptions({ filter_key, filter_value, orientation, disabled, children }) {
    const { setFilterKeys, setOnlyFilterKeys } = useFilters();
    const { colors } = useColors();
    const { settings } = useSettings();

    const [is_parent_hovered, set_is_parent_hovered] = useState(false);
    const [is_popup_hovered, set_is_popup_hovered] = useState(false);
    const trigger_ref = useRef(null);
    const [position, set_position] = useState(null);

    const is_hovered = is_parent_hovered || is_popup_hovered;

    function close_popup() {
        set_is_parent_hovered(false);
        set_is_popup_hovered(false);
    }

    useEffect(() => {
        if (is_hovered && trigger_ref.current) {
            const rect = trigger_ref.current.getBoundingClientRect();

            let top = rect.top - rect.height * 1.5;
            let left;

            if (orientation === "right") {
                left = rect.right;
            } else {
                left = rect.left - rect.width * 1.4;
            }

            set_position({ top, left });
        }
    }, [is_parent_hovered, is_popup_hovered]);

    return (
        <div
            ref={trigger_ref}
            className="relative"
            onMouseEnter={() => {
                if (!disabled) {
                    set_is_parent_hovered(true);
                }
            }}
            onMouseLeave={() => set_is_parent_hovered(false)}
        >
            {children}
            {is_hovered &&
                position &&
                createPortal(
                    <div
                        className="fixed flex flex-col z-[100] border border-gray-500 shadow-xl rounded-lg p-3 w-[5.6rem]"
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
                                on_click={() => {
                                    setOnlyFilterKeys(filter_key, filter_value);
                                    close_popup();
                                }}
                            >
                                ONLY
                            </Button>
                            <Button
                                color="green"
                                className="w-16 px-2"
                                on_click={() => {
                                    setFilterKeys(filter_key, true, settings.disabled_bands);
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

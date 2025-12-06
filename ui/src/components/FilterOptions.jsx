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

    const [is_hovered, set_is_hovered] = useState(false);
    const trigger_ref = useRef(null);
    const [position, set_position] = useState(null);

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
    }, [is_hovered, orientation]);

    return (
        <div
            ref={trigger_ref}
            className="relative"
            onMouseEnter={() => {
                if (disabled) return;
                set_is_hovered(true);
            }}
            onMouseLeave={() => set_is_hovered(false)}
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
                        onMouseEnter={() => set_is_hovered(true)}
                        onMouseLeave={() => set_is_hovered(false)}
                    >
                        <div className="space-y-4">
                            <Button
                                color="blue"
                                className="w-16 px-2"
                                on_click={() => {
                                    setOnlyFilterKeys(filter_key, filter_value);
                                    set_is_hovered(false);
                                }}
                            >
                                ONLY
                            </Button>
                            <Button
                                color="green"
                                className="w-16 px-2"
                                on_click={() => {
                                    setFilterKeys(filter_key, true, settings.disabled_bands);
                                    set_is_hovered(false);
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

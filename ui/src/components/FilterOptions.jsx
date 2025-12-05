import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

import Button from "@/components/Button.jsx";
import { useFilters } from "../hooks/useFilters";
import { useColors } from "@/hooks/useColors";
import { useSettings } from "@/hooks/useSettings";

function FilterOptions({ filter_key, filter_value, align, orientation, disabled, children }) {
    const { setFilterKeys, setOnlyFilterKeys } = useFilters();
    const { colors } = useColors();
    const { settings } = useSettings();

    const [is_hovered, set_is_hovered] = useState(false);
    const triggerRef = useRef(null);
    const [position, setPosition] = useState({ top: 0, left: 0 });

    useEffect(() => {
        if (is_hovered && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            const popupWidth = 88;
            const popupHeight = 100;

            let top = rect.top + rect.height / 2 - popupHeight / 2;
            let left;

            if (orientation === "right") {
                left = rect.right + 8;
            } else {
                left = rect.left - popupWidth - 8;
            }

            setPosition({ top, left });
        }
    }, [is_hovered, orientation]);

    const popupClasses = [
        "fixed",
        "flex",
        "flex-col",
        "z-[100]",
        "border",
        "border-gray-500",
        "shadow-xl",
        "rounded-lg",
        "p-3",
        "w-22",
    ].join(" ");

    return (
        <div
            ref={triggerRef}
            className="relative"
            onMouseEnter={() => {
                if (disabled) return;
                set_is_hovered(true);
            }}
            onMouseLeave={() => set_is_hovered(false)}
        >
            {children}
            {is_hovered &&
                createPortal(
                    <div
                        className={popupClasses}
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

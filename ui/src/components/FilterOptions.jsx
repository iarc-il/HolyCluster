import React, { useState } from "react";

import Button from "@/components/Button.jsx";
import { useFilters } from "../hooks/useFilters";
import { useColors } from "@/hooks/useColors";

function FilterOptions({ filter_key, filter_value, align, orientation, disabled, children }) {
    const { setFilterKeys, setOnlyFilterKeys } = useFilters();
    const { colors } = useColors();

    const [is_hovered, set_is_hovered] = useState(false);
    let classes = [
        "absolute",
        "flex",
        "flex-col",
        "z-50",
        "border",
        "border-gray-500",
        "bg-gray-100",
        "shadow-xl",
        "rounded-lg",
        "p-3",
        "-translate-x-1/2",
        "w-22",
    ];
    const orientation_options = {
        right: ["-translate-y-1/2", "translate-x-[4rem]"],
        left: ["-translate-y-1/2", "-translate-x-[5.6rem]"],
    };
    classes.push(...orientation_options[orientation]);

    classes = classes.join(" ");

    return (
        <div
            className="relative"
            onMouseEnter={() => {
                if (disabled) return;
                set_is_hovered(true);
            }}
            onMouseLeave={() => set_is_hovered(false)}
        >
            {children}
            {is_hovered && (
                <div className={classes} style={{ backgroundColor: colors.theme.background }}>
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
                                setFilterKeys(filter_key, true);
                                set_is_hovered(false);
                            }}
                        >
                            ALL
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default FilterOptions;

import { useLocalStorage } from "@uidotdev/usehooks";
import { useEffect, useState } from "react";
import { useSwipeable } from "react-swipeable";
import { useColors } from "@/hooks/useColors";

function Tabs({ tabs, active_color = null, local_storage_name = null, external_tab = null }) {
    const { colors } = useColors();
    const [active_tab, set_active_tab] = useLocalStorage(local_storage_name, 0);

    useEffect(() => {
        if (local_storage_name == null) {
            set_active_tab(0);
        }
    }, []);

    useEffect(() => {
        if (external_tab != null) {
            set_active_tab(external_tab);
        }
    }, [external_tab]);

    const handlers = useSwipeable({
        onSwipedLeft: () => {
            console.log("Left");
            if (active_tab < tabs.length - 1) {
                set_active_tab(active_tab + 1);
            }
        },
        onSwipedRight: () => {
            console.log("Right");
            if (active_tab > 0) {
                set_active_tab(active_tab - 1);
            }
        },
        trackMouse: false,
        preventScrollOnSwipe: true,
    });

    active_color = active_color || colors.theme.highlighted_tab;

    return (
        <div className="h-full w-full">
            <div className="flex border-b">
                {tabs.map((tab, index) => {
                    const bg = tab.bg || colors.theme.background;
                    const text_color = tab.text_color || colors.theme.text;

                    return (
                        <button
                            key={index}
                            className="flex-1 text-center py-2 text-sm font-medium relative after:absolute after:bottom-0 after:left-0 after:right-0 after:h-1 after:transition-colors"
                            style={{
                                backgroundColor: bg,
                            }}
                            onClick={() => set_active_tab(index)}
                        >
                            <div
                                className="absolute bottom-0 left-0 right-0 h-1"
                                style={{
                                    backgroundColor: active_tab == index ? active_color : bg,
                                }}
                            />
                            <div
                                className="inline-flex items-center justify-center"
                                style={{ color: text_color }}
                            >
                                {tab.icon != null ? (
                                    <svg
                                        width="16"
                                        height="16"
                                        fill="currentColor"
                                        className="bi bi-globe"
                                        viewBox="0 0 16 16"
                                    >
                                        <path d={tab.icon} />
                                    </svg>
                                ) : (
                                    ""
                                )}
                                &nbsp;{tab.label}
                            </div>
                        </button>
                    );
                })}
            </div>

            <div {...handlers} className="w-full h-[calc(100%-42px)]">
                {tabs[active_tab].content}
            </div>
        </div>
    );
}

export default Tabs;

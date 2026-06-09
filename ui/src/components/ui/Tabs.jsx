import { useColors } from "@/hooks/useColors";
import { useLocalStorage } from "@uidotdev/usehooks";
import { useEffect } from "react";
import { useSwipeable } from "react-swipeable";

function get_clamped_tab_index(index, tab_count) {
    const numeric_index = Number(index);
    if (!Number.isInteger(numeric_index) || numeric_index < 0 || tab_count <= 0) {
        return 0;
    }

    return Math.min(numeric_index, tab_count - 1);
}

function Tabs({ tabs, active_color = null, local_storage_name = null, external_tab = null }) {
    const { colors } = useColors();
    const [active_tab, set_active_tab] = useLocalStorage(local_storage_name, 0);
    const active_tab_index = get_clamped_tab_index(active_tab, tabs.length);

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

    useEffect(() => {
        if (active_tab !== active_tab_index) {
            set_active_tab(active_tab_index);
        }
    }, [active_tab, active_tab_index, set_active_tab]);

    const handlers = useSwipeable({
        onSwipedLeft: () => {
            if (active_tab_index < tabs.length - 1) {
                set_active_tab(active_tab_index + 1);
            }
        },
        onSwipedRight: () => {
            if (active_tab_index > 0) {
                set_active_tab(active_tab_index - 1);
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
                                    backgroundColor: active_tab_index == index ? active_color : bg,
                                }}
                            />
                            <div
                                className="inline-flex items-center justify-center"
                                style={{ color: text_color, fontSize: tab.font_size ?? 14 }}
                            >
                                {tab.icon != null ? (
                                    <svg
                                        width={tab.size}
                                        height={tab.size}
                                        fill="currentColor"
                                        className="bi bi-globe"
                                        viewBox={tab.viewbox}
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
                {tabs[active_tab_index]?.content ?? null}
            </div>
        </div>
    );
}

export default Tabs;

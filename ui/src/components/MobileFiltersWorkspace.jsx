import Filters from "@/components/Filters.jsx";
import LeftColumn from "@/components/LeftColumn.jsx";
import { ContinentColumn, SwapButton } from "@/components/SidePanel.jsx";
import {
    TOUR_OPEN_FILTERS_EVENT,
    TOUR_PREPARE_QUICK_FILTERS_EVENT,
} from "@/components/tour/tour_events.js";
import { useColors } from "@/hooks/useColors";
import { useEffect, useState } from "react";

export default function MobileFiltersWorkspace({ visible }) {
    const { colors } = useColors();
    const [active_view, set_active_view] = useState("quick");
    useEffect(() => {
        const show_quick_filters = () => set_active_view("quick");
        document.addEventListener(TOUR_OPEN_FILTERS_EVENT, show_quick_filters);
        document.addEventListener(TOUR_PREPARE_QUICK_FILTERS_EVENT, show_quick_filters);
        return () => {
            document.removeEventListener(TOUR_OPEN_FILTERS_EVENT, show_quick_filters);
            document.removeEventListener(TOUR_PREPARE_QUICK_FILTERS_EVENT, show_quick_filters);
        };
    }, []);
    return (
        <div className="flex flex-col h-full min-w-0" style={{ color: colors.theme.text }}>
            <div
                className="flex shrink-0 border-b-2"
                style={{ borderColor: colors.table.header_arrow }}
            >
                {[
                    { id: "quick", label: "Quick", aria_label: "Quick filters" },
                    { id: "custom", label: "Custom", aria_label: "Custom filters" },
                ].map(view => {
                    const active = active_view === view.id;
                    return (
                        <button
                            key={view.id}
                            type="button"
                            className={`flex min-h-14 flex-1 items-center justify-center border-b-2 text-sm font-semibold transition-colors ${active ? "" : "opacity-60"}`}
                            aria-label={view.aria_label}
                            aria-controls={`mobile-${view.id}-filters`}
                            aria-pressed={active}
                            data-tour={`mobile-${view.id}-filters`}
                            style={{
                                borderColor: active ? colors.theme.text : "transparent",
                                backgroundColor: active
                                    ? colors.theme.input_background
                                    : "transparent",
                            }}
                            onClick={() => set_active_view(view.id)}
                        >
                            {view.label}
                        </button>
                    );
                })}
            </div>
            <div
                id="mobile-quick-filters"
                className={active_view === "quick" ? "flex-1 min-h-0" : "hidden"}
            >
                <LeftColumn
                    mobile
                    visible={visible}
                    content={
                        <>
                            <ContinentColumn mobile spot_type="dx" colors={colors} />
                            <SwapButton mobile colors={colors} />
                            <ContinentColumn mobile spot_type="spotter" colors={colors} />
                        </>
                    }
                />
            </div>
            <div
                id="mobile-custom-filters"
                className={active_view === "custom" ? "flex-1 min-h-0 overflow-y-auto" : "hidden"}
            >
                <Filters />
            </div>
        </div>
    );
}

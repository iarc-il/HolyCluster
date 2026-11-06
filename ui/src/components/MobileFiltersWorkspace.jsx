import Filters from "@/components/Filters.jsx";
import LeftColumn from "@/components/LeftColumn.jsx";
import { ContinentColumn, SwapButton } from "@/components/SidePanel.jsx";
import WebsiteTour from "@/components/tour/WebsiteTour.jsx";
import { TOUR_OPEN_FILTERS_EVENT } from "@/components/tour/tour_events.js";
import { useColors } from "@/hooks/useColors";
import { useEffect, useState } from "react";

export default function MobileFiltersWorkspace({ visible }) {
    const { colors } = useColors();
    const [custom, set_custom] = useState(false);
    useEffect(() => {
        const show_quick_filters = () => set_custom(false);
        document.addEventListener(TOUR_OPEN_FILTERS_EVENT, show_quick_filters);
        return () => document.removeEventListener(TOUR_OPEN_FILTERS_EVENT, show_quick_filters);
    }, []);
    return (
        <div className="flex flex-col h-full min-w-0" style={{ color: colors.theme.text }}>
            <button
                type="button"
                className="flex items-center justify-between min-h-11 shrink-0 border-b px-3 text-left font-semibold"
                aria-label={custom ? "Back to quick filters" : "Custom filters"}
                data-tour="mobile-custom-filters"
                aria-pressed={custom}
                onClick={() => set_custom(!custom)}
            >
                <span>{custom ? "← Bands, modes, and continents" : "Custom filters"}</span>
                {!custom && <span aria-hidden="true">›</span>}
            </button>
            <div className={custom ? "hidden" : "flex-1 min-h-0"}>
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
            <div className={custom ? "flex-1 min-h-0 overflow-y-auto" : "hidden"}>
                <Filters />
            </div>
            <div className="flex shrink-0 justify-start border-t p-2">
                <WebsiteTour is_mobile />
            </div>
        </div>
    );
}

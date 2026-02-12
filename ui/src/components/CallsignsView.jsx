import Filters from "@/components/Filters.jsx";
import FrequencyBar from "@/components/FrequencyBar.jsx";
import Heatmap from "@/components/Heatmap.jsx";

import { useColors } from "../hooks/useColors";

function CallsignsView({ toggled_ui, set_cat_to_spot, active_view }) {
    const { colors } = useColors();

    if (active_view === null) return null;

    const content = [
        <Filters toggled_ui={toggled_ui} />,
        <FrequencyBar set_cat_to_spot={set_cat_to_spot} className={"px-2 h-full"} />,
        <div className="p-2">
            <Heatmap />
        </div>,
    ];

    const toggled_classes = toggled_ui.right_visible ? "max-2xl:absolute right-16 top-0" : "hidden";
    return (
        <div
            className={
                toggled_classes +
                " 2xl:flex flex-col h-full divide-y divide-slate-300 w-56 2xl:w-[34rem] z-50"
            }
            style={{ backgroundColor: colors.theme.background }}
        >
            {content[active_view]}
        </div>
    );
}

export default CallsignsView;

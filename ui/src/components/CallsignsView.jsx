import Filters from "@/components/Filters.jsx";
import Tabs from "@/components/Tabs.jsx";
import FrequencyBar from "@/components/FrequencyBar.jsx";

import { useColors } from "../hooks/useColors";

function CallsignsView({ toggled_ui, set_cat_to_spot }) {
    const { colors } = useColors();

    const filters_component = <Filters toggled_ui={toggled_ui} />;

    const freq_bar = <FrequencyBar set_cat_to_spot={set_cat_to_spot} className={"px-2 h-full"} />;

    const toggled_classes = toggled_ui.right
        ? "hidden"
        : "max-2xl:absolute right-20 top-0 border-l border-slate-300";
    return (
        <div
            className={
                toggled_classes +
                " 2xl:flex flex-col bg-white h-full divide-y divide-slate-300 w-56 2xl:w-[30rem] z-[70]"
            }
            style={{ backgroundColor: colors.theme.background }}
        >
            <Tabs
                local_storage_name="filter_frequency_bar_tab"
                active_color="#0b141a"
                tabs={[
                    {
                        label: "Filters",
                        content: filters_component,
                        bg: "#dbeafe",
                        text_color: "black",
                        icon: "M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5zm1 .5v1.308l4.372 4.858A.5.5 0 0 1 7 8.5v5.306l2-.666V8.5a.5.5 0 0 1 .128-.334L13.5 3.308V2z",
                    },
                    {
                        label: "Band Bar",
                        bg: "#fecaca",
                        text_color: "black",
                        content: freq_bar,
                        icon: "M3.05 3.05a7 7 0 0 0 0 9.9.5.5 0 0 1-.707.707 8 8 0 0 1 0-11.314.5.5 0 0 1 .707.707m2.122 2.122a4 4 0 0 0 0 5.656.5.5 0 1 1-.708.708 5 5 0 0 1 0-7.072.5.5 0 0 1 .708.708m5.656-.708a.5.5 0 0 1 .708 0 5 5 0 0 1 0 7.072.5.5 0 1 1-.708-.708 4 4 0 0 0 0-5.656.5.5 0 0 1 0-.708m2.122-2.12a.5.5 0 0 1 .707 0 8 8 0 0 1 0 11.313.5.5 0 0 1-.707-.707 7 7 0 0 0 0-9.9.5.5 0 0 1 0-.707zM6 8a2 2 0 1 1 2.5 1.937V15.5a.5.5 0 0 1-1 0V9.937A2 2 0 0 1 6 8",
                    },
                ]}
            ></Tabs>
        </div>
    );
}

export default CallsignsView;

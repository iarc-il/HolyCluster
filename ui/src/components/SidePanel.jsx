import Filters from "@/components/Filters.jsx";
import FrequencyBar from "@/components/FrequencyBar.jsx";
import Heatmap from "@/components/Heatmap.jsx";
import DXpeditions from "@/components/DXpeditions.jsx";

import { useColors } from "../hooks/useColors";

const view_options = [
    {
        label: "Filters",
        bg: "#93c5fd",
        icon: "M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5zm1 .5v1.308l4.372 4.858A.5.5 0 0 1 7 8.5v5.306l2-.666V8.5a.5.5 0 0 1 .128-.334L13.5 3.308V2z",
        viewbox: "0 0 16 16",
        size: 32,
    },
    {
        label: "Band Bar",
        bg: "#a855f7",
        icon: "M3.05 3.05a7 7 0 0 0 0 9.9.5.5 0 0 1-.707.707 8 8 0 0 1 0-11.314.5.5 0 0 1 .707.707m2.122 2.122a4 4 0 0 0 0 5.656.5.5 0 1 1-.708.708 5 5 0 0 1 0-7.072.5.5 0 0 1 .708.708m5.656-.708a.5.5 0 0 1 .708 0 5 5 0 0 1 0 7.072.5.5 0 1 1-.708-.708 4 4 0 0 0 0-5.656.5.5 0 0 1 0-.708m2.122-2.12a.5.5 0 0 1 .707 0 8 8 0 0 1 0 11.313.5.5 0 0 1-.707-.707 7 7 0 0 0 0-9.9.5.5 0 0 1 0-.707zM6 8a2 2 0 1 1 2.5 1.937V15.5a.5.5 0 0 1-1 0V9.937A2 2 0 0 1 6 8",
        viewbox: "0 0 16 16",
        size: 32,
    },
    {
        label: "Heatmap",
        bg: "#f72e2e",
        icon: "M14.4527 8.48679L12.1842 3.93896L11.4471 4.74309C7.30945 9.25693 6 11.9609 6 14.2499C6 17.422 8.73452 19.909 12 19.909C15.2655 19.909 18 17.422 18 14.2499C18 13.3179 17.6746 12.3124 17.2381 11.3658C16.796 10.4069 16.2091 9.44335 15.62 8.57788L15.1065 7.82342L14.4527 8.48679ZM14.0473 11.0348L14.8818 10.1883C15.256 10.7846 15.6008 11.397 15.876 11.9938C16.2765 12.8625 16.5 13.6357 16.5 14.2499C16.5 15.0941 16.2233 15.8901 15.7438 16.5554C15.7479 16.4935 15.75 16.4309 15.75 16.3675C15.75 15.8056 15.5231 15.2413 15.2632 14.7624C14.9946 14.2679 14.6434 13.7798 14.2995 13.3507L13.8135 12.7443L13.4772 13.034L12.1744 10.8159L11.4903 11.4497C9.13721 13.6298 8.25 15.0508 8.25 16.3675C8.25 16.4309 8.25209 16.4935 8.25622 16.5554C7.77669 15.8901 7.5 15.0941 7.5 14.2499C7.5 12.6786 8.327 10.5308 11.8206 6.5705L14.0473 11.0348ZM13.0943 15.344L13.5948 14.9127C13.7259 15.1036 13.8447 15.2936 13.9449 15.4781C14.1632 15.8802 14.25 16.1791 14.25 16.3675C14.25 17.1171 13.4131 17.9999 12 17.9999C10.5869 17.9999 9.75 17.1171 9.75 16.3675C9.75 15.8235 10.0697 14.9464 11.8334 13.1972L13.0943 15.344Z",
        viewbox: "0 0 24 24",
        size: 44,
    },
    {
        label: "DXpeditions",
        bg: "#FFD700",
        icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z",
        viewbox: "0 0 24 24",
        size: 32,
    },
];

function ViewSelectorTabs({ active_view, set_active_view, colors }) {
    return (
        <div
            className="flex shrink-0"
            style={{ borderBottom: `1px solid ${colors.theme.borders}` }}
        >
            {view_options.map((option, index) => {
                const is_active = active_view === index;
                return (
                    <div
                        key={option.label}
                        onClick={() => {
                            if (!is_active) {
                                set_active_view(index);
                            }
                        }}
                        className={
                            "flex items-center justify-center flex-1 py-1.5 transition-colors rounded-md" +
                            (!is_active ? " cursor-pointer opacity-60 hover:opacity-100" : "")
                        }
                        style={{
                            backgroundColor: is_active ? colors.buttons.active_tab : undefined,
                        }}
                        title={option.label}
                    >
                        <svg
                            width={option.size}
                            height={option.size}
                            viewBox={option.viewbox}
                            fill={is_active ? option.bg : colors.buttons.utility}
                        >
                            <path d={option.icon} />
                        </svg>
                    </div>
                );
            })}
        </div>
    );
}

function SidePanel({ toggled_ui, set_cat_to_spot, active_view, set_active_view }) {
    const { colors } = useColors();

    if (active_view === null) return null;

    const content = [
        <Filters toggled_ui={toggled_ui} />,
        <FrequencyBar set_cat_to_spot={set_cat_to_spot} className={"px-2 h-full"} />,
        <div className="p-2">
            <Heatmap />
        </div>,
        <DXpeditions />,
    ];

    const toggled_classes = toggled_ui.right_visible ? "max-2xl:absolute right-16 top-0" : "hidden";
    return (
        <div
            className={toggled_classes + " 2xl:flex flex-col h-full w-56 2xl:w-[34rem] z-50"}
            style={{ backgroundColor: colors.theme.background }}
        >
            <ViewSelectorTabs
                active_view={active_view}
                set_active_view={set_active_view}
                colors={colors}
            />
            <div className="flex-1 overflow-y-auto divide-y divide-slate-300">
                {content[active_view]}
            </div>
        </div>
    );
}

export default SidePanel;

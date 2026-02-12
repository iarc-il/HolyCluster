import FilterOptions from "@/components/FilterOptions.jsx";
import FilterButton from "@/components/FilterButton.jsx";
import { continents } from "@/filters_data.js";
import { useFilters } from "../hooks/useFilters";
import { useColors } from "../hooks/useColors";
import UtilityButtons from "./UtilityButtons";

const title = { dx: "DX", spotter: "DE" };

const view_options = [
    {
        label: "Filters",
        bg: "#93c5fd",
        icon: "M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5zm1 .5v1.308l4.372 4.858A.5.5 0 0 1 7 8.5v5.306l2-.666V8.5a.5.5 0 0 1 .128-.334L13.5 3.308V2z",
        viewbox: "0 0 16 16",
        size: 36,
    },
    {
        label: "Band Bar",
        bg: "#f87171",
        icon: "M3.05 3.05a7 7 0 0 0 0 9.9.5.5 0 0 1-.707.707 8 8 0 0 1 0-11.314.5.5 0 0 1 .707.707m2.122 2.122a4 4 0 0 0 0 5.656.5.5 0 1 1-.708.708 5 5 0 0 1 0-7.072.5.5 0 0 1 .708.708m5.656-.708a.5.5 0 0 1 .708 0 5 5 0 0 1 0 7.072.5.5 0 1 1-.708-.708 4 4 0 0 0 0-5.656.5.5 0 0 1 0-.708m2.122-2.12a.5.5 0 0 1 .707 0 8 8 0 0 1 0 11.313.5.5 0 0 1-.707-.707 7 7 0 0 0 0-9.9.5.5 0 0 1 0-.707zM6 8a2 2 0 1 1 2.5 1.937V15.5a.5.5 0 0 1-1 0V9.937A2 2 0 0 1 6 8",
        viewbox: "0 0 16 16",
        size: 36,
    },
    {
        label: "Heatmap",
        bg: "#a855f7",
        icon: "M14.4527 8.48679L12.1842 3.93896L11.4471 4.74309C7.30945 9.25693 6 11.9609 6 14.2499C6 17.422 8.73452 19.909 12 19.909C15.2655 19.909 18 17.422 18 14.2499C18 13.3179 17.6746 12.3124 17.2381 11.3658C16.796 10.4069 16.2091 9.44335 15.62 8.57788L15.1065 7.82342L14.4527 8.48679ZM14.0473 11.0348L14.8818 10.1883C15.256 10.7846 15.6008 11.397 15.876 11.9938C16.2765 12.8625 16.5 13.6357 16.5 14.2499C16.5 15.0941 16.2233 15.8901 15.7438 16.5554C15.7479 16.4935 15.75 16.4309 15.75 16.3675C15.75 15.8056 15.5231 15.2413 15.2632 14.7624C14.9946 14.2679 14.6434 13.7798 14.2995 13.3507L13.8135 12.7443L13.4772 13.034L12.1744 10.8159L11.4903 11.4497C9.13721 13.6298 8.25 15.0508 8.25 16.3675C8.25 16.4309 8.25209 16.4935 8.25622 16.5554C7.77669 15.8901 7.5 15.0941 7.5 14.2499C7.5 12.6786 8.327 10.5308 11.8206 6.5705L14.0473 11.0348ZM13.0943 15.344L13.5948 14.9127C13.7259 15.1036 13.8447 15.2936 13.9449 15.4781C14.1632 15.8802 14.25 16.1791 14.25 16.3675C14.25 17.1171 13.4131 17.9999 12 17.9999C10.5869 17.9999 9.75 17.1171 9.75 16.3675C9.75 15.8235 10.0697 14.9464 11.8334 13.1972L13.0943 15.344Z",
        viewbox: "0 0 24 24",
        size: 36,
    },
];

function ContinentColumn({ spot_type, colors }) {
    const { filters, setFilters } = useFilters();
    const filter_key = `${spot_type}_continents`;

    const color = colors.buttons[spot_type + "_continents"];

    return (
        <div className="flex flex-col gap-3 items-center p-1">
            <strong style={{ color: colors.theme.text }}>{title[spot_type]}</strong>
            {continents.map(continent => (
                <FilterOptions
                    key={spot_type + "_" + continent}
                    filter_key={filter_key}
                    filter_value={continent}
                    orientation="left"
                >
                    <FilterButton
                        color={color}
                        text={continent}
                        is_active={filters[filter_key][continent]}
                        on_click={_ => {
                            setFilters(state => ({
                                ...state,
                                [filter_key]: {
                                    ...state[filter_key],
                                    [continent]: !state[filter_key][continent],
                                },
                            }));
                        }}
                    />
                </FilterOptions>
            ))}
        </div>
    );
}

function SwapButton({ colors }) {
    const { filters, setFilters } = useFilters();

    const areFiltersEqual = continents.every(
        continent => filters.dx_continents[continent] === filters.spotter_continents[continent],
    );

    const swapContinents = () => {
        if (areFiltersEqual) return;
        setFilters(state => ({
            ...state,
            dx_continents: { ...state.spotter_continents },
            spotter_continents: { ...state.dx_continents },
        }));
    };

    return (
        <div
            onClick={swapContinents}
            className={`w-16 text-center rounded-full select-none border border-slate-700 flex justify-center py-0.5 ${
                areFiltersEqual
                    ? "opacity-50 pointer-events-none"
                    : "cursor-pointer hover:brightness-110"
            }`}
            style={{ backgroundColor: colors.buttons.disabled_background }}
            title="Swap DX and DE continent filters"
        >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                    d="M7 4L7 20M7 4L3 8M7 4L11 8"
                    stroke="#000000"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                <path
                    d="M17 20L17 4M17 20L21 16M17 20L13 16"
                    stroke="#000000"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        </div>
    );
}

function ViewSelectorButtons({ active_view, set_active_view, colors }) {
    return (
        <div className="space-y-3">
            {view_options.map((option, index) => {
                const is_active = active_view === index;
                return (
                    <div
                        key={option.label}
                        onClick={() => set_active_view(is_active ? null : index)}
                        className="cursor-pointer"
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

function RightColumn({ toggled_ui, active_view, set_active_view }) {
    const { colors } = useColors();

    const toggled_classes = toggled_ui.right_visible
        ? "max-2xl:absolute right-0 top-0 "
        : "max-2xl:hidden ";
    return (
        <div
            className={
                toggled_classes +
                "flex flex-col gap-2 w-18 text-center h-full bg-gray-100 z-50 overflow-y-auto shrink-0"
            }
            style={{ backgroundColor: colors.theme.columns }}
        >
            <ContinentColumn spot_type="dx" colors={colors} />
            <div className="flex border-slate-300 border-t-2 border-b-2 py-4 justify-center">
                <SwapButton colors={colors} />
            </div>
            <ContinentColumn spot_type="spotter" colors={colors} />
            <div className="flex flex-col items-center mt-auto mb-2 space-y-3">
                <ViewSelectorButtons
                    active_view={active_view}
                    set_active_view={set_active_view}
                    colors={colors}
                />
                <div className="border-t-2 border-slate-300 w-full" />
                <UtilityButtons />
            </div>
        </div>
    );
}

export default RightColumn;

import FilterOptions from "@/components/FilterOptions.jsx";
import FilterButton from "@/components/FilterButton.jsx";
import { continents } from "@/filters_data.js";
import { useFilters } from "../hooks/useFilters";
import { useColors } from "../hooks/useColors";
import UtilityButtons from "./UtilityButtons";

const title = { dx: "DX", spotter: "DE" };

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
    const { setFilters } = useFilters();

    const swapContinents = () => {
        setFilters(state => ({
            ...state,
            dx_continents: { ...state.spotter_continents },
            spotter_continents: { ...state.dx_continents },
        }));
    };

    return (
        <div
            onClick={swapContinents}
            className="w-16 text-center rounded-full cursor-pointer select-none border border-slate-700 hover:brightness-110 flex justify-center py-0.5"
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

function Continents({ toggled_ui }) {
    const { colors } = useColors();

    const toggled_classes = toggled_ui.right
        ? "max-2xl:hidden "
        : "max-2xl:absolute right-0 top-0 ";
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
            <div className="flex mt-auto mb-2 justify-center">
                <UtilityButtons />
            </div>
        </div>
    );
}

export default Continents;

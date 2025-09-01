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
        <>
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
            <div className="h-8"></div>
        </>
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
                "flex flex-col w-20 p-2 text-center h-full gap-3 items-center bg-gray-100 z-50"
            }
            style={{ backgroundColor: colors.theme.columns }}
        >
            {["dx", "spotter"].map(spot_type => (
                <ContinentColumn key={spot_type} spot_type={spot_type} colors={colors} />
            ))}
            <div className="mt-auto mb-2">
                <UtilityButtons />
            </div>
        </div>
    );
}

export default Continents;

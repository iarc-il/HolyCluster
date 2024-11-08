import { band_colors } from "@/filters_data.js";
import FilterOptions from "@/components/FilterOptions.jsx";
import FilterButton from "@/components/FilterButton.jsx";

function Bands({ filters, set_filters }) {
    return <div className="w-32 min-w-20 p-2 flex flex-col text-center h-full gap-3">
        {[...band_colors].map(([band, color]) => {
            return <FilterOptions
                key={band}
                set_filters={set_filters}
                filter_key="bands"
                filter_value={band}
                orientation="vertical"
                align="center"
            >
                <FilterButton
                    text={band + "m"}
                    is_active={filters.bands[band]}
                    color={color}
                    on_click={_ => set_filters(state => state.bands[band] = !state.bands[band])}
                    hover_brightness="125"/>
            </FilterOptions>;
        })}
    </div>;
}

export default Bands;

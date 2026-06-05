import { createContext, useContext, useState } from "react";

const SpotInteractionContext = createContext(undefined);

export function useSpotInteraction() {
    return useContext(SpotInteractionContext);
}

export const SpotInteractionProvider = ({ children }) => {
    let [hovered_spot, set_hovered_spot] = useState({
        source: null,
        id: null,
        dxpedition_id: null,
    });
    let [hovered_band, set_hovered_band] = useState(null);
    let [pinned_spot, set_pinned_spot] = useState(null);
    let [search_query, set_search_query] = useState("");
    let [selected_reference_type, set_selected_reference_type] = useState(null);
    const is_pota_mode = selected_reference_type !== null;

    return (
        <SpotInteractionContext.Provider
            value={{
                hovered_spot,
                set_hovered_spot,
                hovered_band,
                set_hovered_band,
                pinned_spot,
                set_pinned_spot,
                search_query,
                set_search_query,
                is_pota_mode,
                selected_reference_type,
                set_selected_reference_type,
            }}
        >
            {children}
        </SpotInteractionContext.Provider>
    );
};

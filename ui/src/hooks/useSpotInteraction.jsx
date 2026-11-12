import { createContext, useCallback, useContext, useState } from "react";

const SpotInteractionContext = createContext(undefined);

export function useSpotInteraction() {
    return useContext(SpotInteractionContext);
}

export const SpotInteractionProvider = ({ children }) => {
    const [hovered_spot, set_hovered_spot] = useState({
        source: null,
        id: null,
        dxpedition_id: null,
    });
    const [hovered_band, set_hovered_band] = useState(null);
    const [pinned_spot, set_pinned_spot_state] = useState(null);
    const set_pinned_spot = useCallback(spot_id => {
        if (spot_id !== null && typeof spot_id !== "string") {
            throw new TypeError("Pinned spot must be a spot ID or null");
        }
        set_pinned_spot_state(spot_id);
    }, []);
    const [search_query, set_search_query] = useState("");
    const [selected_reference_type, set_selected_reference_type] = useState(null);
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

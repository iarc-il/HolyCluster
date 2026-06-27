import { useColors } from "@/hooks/useColors";
import { createContext, useContext, useEffect, useState } from "react";

const SpotInteractionContext = createContext(undefined);

export function useSpotInteraction() {
    return useContext(SpotInteractionContext);
}

export const SpotInteractionProvider = ({ children }) => {
    const { dev_mode } = useColors();
    const [hovered_spot, set_hovered_spot] = useState({
        source: null,
        id: null,
        dxpedition_id: null,
    });
    const [hovered_band, set_hovered_band] = useState(null);
    const [pinned_spot, set_pinned_spot] = useState(null);
    const [search_query, set_search_query] = useState("");
    const [selected_reference_type, set_selected_reference_type] = useState(null);
    const effective_selected_reference_type = dev_mode ? selected_reference_type : null;
    const is_pota_mode = effective_selected_reference_type !== null;

    useEffect(() => {
        if (!dev_mode) {
            set_selected_reference_type(null);
        }
    }, [dev_mode]);

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
                selected_reference_type: effective_selected_reference_type,
                set_selected_reference_type,
            }}
        >
            {children}
        </SpotInteractionContext.Provider>
    );
};

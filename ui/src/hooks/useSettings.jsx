import { createContext, useContext } from "react";
import { useProfiles } from "@/hooks/useProfiles.jsx";

const SettingsContext = createContext(undefined);

export function useSettings() {
    const context = useContext(SettingsContext);
    if (context === undefined) {
        throw new Error("useSettings must be used within a SettingsProvider");
    }
    return context;
}

export function SettingsProvider({ children }) {
    const {
        active_profile_data: { settings },
        update_active_profile_section,
    } = useProfiles();

    function set_settings(value_or_setter) {
        update_active_profile_section("settings", value_or_setter);
    }

    return (
        <SettingsContext.Provider value={{ settings, set_settings }}>
            {children}
        </SettingsContext.Provider>
    );
}

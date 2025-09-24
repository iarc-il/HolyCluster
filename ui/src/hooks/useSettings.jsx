import { createContext, useContext } from "react";
import { use_object_local_storage } from "@/utils.js";

const SettingsContext = createContext(undefined);

export function useSettings() {
    const context = useContext(SettingsContext);
    if (context === undefined) {
        throw new Error("useSettings must be used within a SettingsProvider");
    }
    return context;
}

export function SettingsProvider({ children }) {
    const [settings, set_settings] = use_object_local_storage("settings", {
        locator: "JJ00AA",
        default_radius: 20000,
        theme: "Light",
        callsign: "",
        is_miles: false,
        propagation_displayed: true,
        show_flags: true,
        show_equator: false,
        highlight_enabled: true,
        highlight_port: 2237,
    });

    return (
        <SettingsContext.Provider value={{ settings, set_settings }}>
            {children}
        </SettingsContext.Provider>
    );
}

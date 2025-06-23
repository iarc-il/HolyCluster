import { useState } from "react";
import Button from "@/components/Button.jsx";
import Toggle from "@/components/Toggle.jsx";
import { useColors } from "@/hooks/useColors";
import { useFilters } from "@/hooks/useFilters";

const EXPORTABLE_SETTINGS = {
    settings: {
        label: "General Settings",
        description: "Locator, radius, theme, units, etc.",
    },
    filters: {
        label: "Band & Mode Filters",
        description: "Band, mode, and continent filters",
    },
    callsign_filters: {
        label: "Callsign Filters",
        description: "Alert, show only, and hide filters",
    },
};

function ImportExport({
    settings,
    set_settings,
    set_temp_settings,
    apply_settings,
    set_should_close_settings,
}) {
    const { colors } = useColors();
    const { filters, setFilters, callsign_filters, setCallsignFilters } = useFilters();

    const [selected_settings, set_selected_settings] = useState(
        Object.fromEntries(Object.keys(EXPORTABLE_SETTINGS).map(key => [key, true])),
    );

    function handle_export() {
        const export_data = {};
        Object.entries(selected_settings).forEach(([key, is_selected]) => {
            if (is_selected) {
                switch (key) {
                    case "settings":
                        export_data.settings = settings;
                        break;
                    case "filters":
                        export_data.filters = filters;
                        break;
                    case "callsign_filters":
                        export_data.callsign_filters = callsign_filters;
                        break;
                }
            }
        });

        const data_str = JSON.stringify(export_data, null, 2);
        const data_blob = new Blob([data_str], { type: "application/json" });
        const url = URL.createObjectURL(data_blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "holycluster-settings.json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function handle_import(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = event => {
            try {
                const imported_data = JSON.parse(event.target.result);

                Object.entries(selected_settings).forEach(([key, is_selected]) => {
                    if (is_selected && imported_data[key]) {
                        switch (key) {
                            case "settings":
                                apply_settings(imported_data.settings);
                                break;
                            case "filters":
                                setFilters(imported_data.filters);
                                break;
                            case "callsign_filters":
                                setCallsignFilters(imported_data.callsign_filters);
                                break;
                        }
                    }
                });
                set_should_close_settings(false);
            } catch (error) {
                console.error("Error importing settings:", error);
            }
        };
        reader.readAsText(file);
        event.target.value = null;
    }

    return (
        <div className="border-t mt-4 pt-4" style={{ color: colors.theme.text }}>
            <h3 className="text-xl mb-4">Import/Export Settings</h3>
            <div className="space-y-2 mb-4">
                {Object.entries(EXPORTABLE_SETTINGS).map(([key, { label, description }]) => (
                    <div key={key} className="flex items-center justify-between">
                        <div>
                            <span className="font-medium">{label}</span>
                            <p className="text-sm opacity-75">{description}</p>
                        </div>
                        <Toggle
                            value={selected_settings[key]}
                            on_click={() =>
                                set_selected_settings(prev => ({
                                    ...prev,
                                    [key]: !prev[key],
                                }))
                            }
                        />
                    </div>
                ))}
            </div>
            <div className="flex justify-between mt-4">
                <div>
                    <input
                        type="file"
                        accept=".json"
                        onChange={handle_import}
                        className="hidden"
                        id="settings-import"
                    />
                    <Button
                        color="blue"
                        on_click={() => document.getElementById("settings-import").click()}
                    >
                        Import from File
                    </Button>
                </div>
                <Button color="green" on_click={handle_export}>
                    Export to File
                </Button>
            </div>
        </div>
    );
}

export default ImportExport;

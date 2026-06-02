import { useState } from "react";
import Button from "@/components/ui/Button.jsx";
import Toggle from "@/components/ui/Toggle.jsx";
import { useColors } from "@/hooks/useColors";
import { useFilters } from "@/hooks/useFilters";
import { useSettings } from "@/hooks/useSettings";

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

async function copy_to_clipboard(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const text_area = document.createElement("textarea");
    text_area.value = text;
    text_area.style.position = "fixed";
    text_area.style.opacity = "0";
    document.body.appendChild(text_area);
    text_area.focus();
    text_area.select();

    const did_copy = document.execCommand("copy");
    document.body.removeChild(text_area);

    if (!did_copy) {
        throw new Error("Clipboard copy failed");
    }
}

function ImportExport({ set_temp_settings, apply_settings, set_should_close_settings }) {
    const { colors } = useColors();
    const {
        filters,
        setFilters,
        callsign_filters,
        setCallsignFilters,
        is_shared_filter_state,
        save_shared_filters,
        get_filter_share_url,
    } = useFilters();
    const { settings } = useSettings();

    const [selected_settings, set_selected_settings] = useState(
        Object.fromEntries(Object.keys(EXPORTABLE_SETTINGS).map(key => [key, true])),
    );
    const [share_status, set_share_status] = useState("");

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

    async function handle_copy_filter_url() {
        try {
            await copy_to_clipboard(get_filter_share_url());
            set_share_status("Filter link copied to clipboard.");
        } catch (_error) {
            set_share_status("Could not copy the filter link.");
        }
    }

    function handle_save_shared_filters() {
        save_shared_filters();
        set_share_status("Shared filters saved as your filters.");
    }

    return (
        <div className="p-4" style={{ color: colors.theme.text }}>
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
            <div className="flex justify-between">
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
            <div
                className="mt-4 pt-4 border-t space-y-3"
                style={{ borderColor: colors.theme.borders }}
            >
                <div>
                    <span className="font-medium">URL Sharing</span>
                    <p className="text-sm opacity-75">
                        Copy a link with the current filter state. Shared links use temporary
                        filters until the URL parameter is removed.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2 justify-between">
                    <Button color="blue" on_click={handle_copy_filter_url}>
                        Copy Filter Link
                    </Button>
                    {is_shared_filter_state ? (
                        <Button color="green" on_click={handle_save_shared_filters}>
                            Save Shared Filters
                        </Button>
                    ) : null}
                </div>
                {share_status ? <p className="text-sm opacity-75">{share_status}</p> : null}
            </div>
        </div>
    );
}

export default ImportExport;

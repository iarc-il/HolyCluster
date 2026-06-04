import { useState } from "react";
import Button from "@/components/ui/Button.jsx";
import Toggle from "@/components/ui/Toggle.jsx";
import { useColors } from "@/hooks/useColors";
import { useFilters } from "@/hooks/useFilters";
import { useProfiles } from "@/hooks/useProfiles.jsx";
import {
    create_profile_export,
    make_unique_profile_name,
    pick_profile_sections,
    PROFILE_SECTION_DEFINITIONS,
    PROFILE_SECTION_KEYS,
    sanitize_imported_profile,
    sanitize_profile_data,
} from "@/utils/profile_data.js";

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

function profile_name_from_file(file) {
    return file.name.replace(/\.json$/i, "").trim() || "Imported Profile";
}

function filename_safe(value) {
    return value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}

function ImportExport({ set_temp_settings }) {
    const { colors } = useColors();
    const { is_shared_filter_state, save_shared_filters, get_filter_share_url } = useFilters();
    const { profiles, active_profile, create_profile } = useProfiles();

    const [selected_sections, set_selected_sections] = useState(
        Object.fromEntries(PROFILE_SECTION_KEYS.map(key => [key, true])),
    );
    const [file_status, set_file_status] = useState("");
    const [share_status, set_share_status] = useState("");

    const selected_section_keys = PROFILE_SECTION_KEYS.filter(key => selected_sections[key]);

    function handle_export() {
        if (selected_section_keys.length === 0) {
            set_file_status("Select at least one section to export.");
            return;
        }

        const export_data = create_profile_export(active_profile, selected_section_keys);
        const data_str = JSON.stringify(export_data, null, 2);
        const data_blob = new Blob([data_str], { type: "application/json" });
        const url = URL.createObjectURL(data_blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `holycluster-${filename_safe(active_profile.name) || "profile"}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        set_file_status("Profile exported.");
    }

    function handle_import(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (selected_section_keys.length === 0) {
            set_file_status("Select at least one section to import.");
            event.target.value = null;
            return;
        }

        const reader = new FileReader();
        reader.onload = event => {
            try {
                const imported_data = JSON.parse(event.target.result);
                const imported_profile = sanitize_imported_profile(
                    imported_data,
                    profile_name_from_file(file),
                );
                const profile_data = sanitize_profile_data(
                    pick_profile_sections(imported_profile.data, selected_section_keys),
                );
                const profile_name = make_unique_profile_name(imported_profile.name, profiles);

                create_profile(profile_name, profile_data);
                set_temp_settings(profile_data.settings);
                set_file_status(`Imported "${profile_name}" as a new profile.`);
            } catch (error) {
                console.error("Error importing profile:", error);
                set_file_status("Could not import the selected profile file.");
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
                {Object.entries(PROFILE_SECTION_DEFINITIONS).map(
                    ([key, { label, description }]) => (
                        <div key={key} className="flex items-center justify-between gap-4">
                            <div>
                                <span className="font-medium">{label}</span>
                                <p className="text-sm opacity-75">{description}</p>
                            </div>
                            <Toggle
                                value={selected_sections[key]}
                                on_click={() =>
                                    set_selected_sections(prev => ({
                                        ...prev,
                                        [key]: !prev[key],
                                    }))
                                }
                            />
                        </div>
                    ),
                )}
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
                        Import as New Profile
                    </Button>
                </div>
                <Button color="green" on_click={handle_export}>
                    Export Profile
                </Button>
            </div>
            {file_status ? <p className="mt-3 text-sm opacity-75">{file_status}</p> : null}
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

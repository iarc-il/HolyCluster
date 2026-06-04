import { useEffect, useState } from "react";
import Button from "@/components/ui/Button.jsx";
import Input from "@/components/ui/Input.jsx";
import Select from "@/components/ui/Select.jsx";
import { useProfiles } from "@/hooks/useProfiles.jsx";

function Profiles({ colors, set_temp_settings }) {
    const {
        profiles,
        active_profile,
        active_profile_name,
        set_active_profile_name,
        create_profile,
        rename_profile,
        delete_profile,
    } = useProfiles();
    const [new_profile_name, set_new_profile_name] = useState("");
    const [rename_value, set_rename_value] = useState(active_profile_name);
    const [error_message, set_error_message] = useState("");

    useEffect(() => {
        set_rename_value(active_profile_name);
        set_error_message("");
    }, [active_profile_name]);

    function sync_temp_settings(profile) {
        set_temp_settings(profile.data.settings);
    }

    function switch_profile(name) {
        const profile = profiles.find(profile => profile.name === name);
        if (!profile) {
            return;
        }

        set_active_profile_name(name);
        sync_temp_settings(profile);
    }

    function handle_create_profile() {
        const name = new_profile_name.trim();
        if (name.length === 0) {
            set_error_message("Enter a profile name.");
            return;
        }

        create_profile(name);
        set_new_profile_name("");
        set_error_message("");
        sync_temp_settings(active_profile);
    }

    function handle_rename_profile() {
        const name = rename_value.trim();
        if (name.length === 0) {
            set_error_message("Enter a profile name.");
            return;
        }

        rename_profile(active_profile_name, name);
        set_error_message("");
    }

    function handle_delete_profile() {
        if (profiles.length <= 1) {
            return;
        }

        const remaining_profiles = profiles.filter(profile => profile.name !== active_profile_name);
        const next_profile = remaining_profiles[0];
        delete_profile(active_profile_name);
        sync_temp_settings(next_profile);
    }

    return (
        <div className="p-4 space-y-6" style={{ color: colors.theme.text }}>
            <div className="space-y-2">
                <label className="block font-medium" htmlFor="active-profile">
                    Active profile
                </label>
                <Select
                    id="active-profile"
                    value={active_profile_name}
                    className="w-full"
                    onChange={event => switch_profile(event.target.value)}
                >
                    {profiles.map(profile => (
                        <option key={profile.name} value={profile.name}>
                            {profile.name}
                        </option>
                    ))}
                </Select>
            </div>

            <div className="space-y-2">
                <label className="block font-medium" htmlFor="new-profile-name">
                    New profile
                </label>
                <div className="flex gap-2">
                    <Input
                        id="new-profile-name"
                        className="w-full"
                        value={new_profile_name}
                        onChange={event => set_new_profile_name(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                event.stopPropagation();
                                handle_create_profile();
                            }
                        }}
                    />
                    <Button on_click={handle_create_profile} className="whitespace-nowrap">
                        Create
                    </Button>
                </div>
            </div>

            <div className="space-y-2">
                <label className="block font-medium" htmlFor="rename-profile-name">
                    Rename active profile
                </label>
                <div className="flex gap-2">
                    <Input
                        id="rename-profile-name"
                        className="w-full"
                        value={rename_value}
                        onChange={event => set_rename_value(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                event.stopPropagation();
                                handle_rename_profile();
                            }
                        }}
                    />
                    <Button on_click={handle_rename_profile} className="whitespace-nowrap">
                        Rename
                    </Button>
                </div>
            </div>

            <div className="flex items-center justify-between gap-4 pt-2">
                <div className="text-sm opacity-75">
                    Deleting is disabled when only one profile exists.
                </div>
                <Button
                    color="red"
                    on_click={handle_delete_profile}
                    disabled={profiles.length <= 1}
                    className="whitespace-nowrap"
                >
                    Delete Active
                </Button>
            </div>

            {error_message ? (
                <p className="text-sm font-semibold text-red-400">{error_message}</p>
            ) : null}
        </div>
    );
}

export default Profiles;

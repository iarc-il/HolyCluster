import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { useLocalStorage } from "@uidotdev/usehooks";
import { useLocation, useNavigate } from "react-router";
import {
    make_unique_profile_name,
    PROFILE_STORE_KEY,
    read_legacy_profile_data,
    sanitize_profile_data,
    sanitize_profile_store,
} from "@/utils/profile_data.js";
import { FILTER_URL_PARAM } from "@/utils/filter_url_state.js";

const ProfilesContext = createContext(undefined);

function are_equal(value_a, value_b) {
    return JSON.stringify(value_a) === JSON.stringify(value_b);
}

function apply_setter_value(previous_value, value_or_setter) {
    return typeof value_or_setter === "function"
        ? value_or_setter(previous_value)
        : value_or_setter;
}

function read_profile_store_snapshot(fallback_value) {
    if (typeof window === "undefined") {
        return fallback_value;
    }

    const raw_store = window.localStorage.getItem(PROFILE_STORE_KEY);
    if (raw_store == null) {
        return fallback_value;
    }

    try {
        return JSON.parse(raw_store);
    } catch (_error) {
        return fallback_value;
    }
}

export function useProfiles() {
    const context = useContext(ProfilesContext);
    if (context === undefined) {
        throw new Error("useProfiles must be used within a ProfilesProvider");
    }
    return context;
}

export function ProfilesProvider({ children }) {
    const location = useLocation();
    const navigate = useNavigate();
    const initial_profile_store = useMemo(
        () => sanitize_profile_store(null, read_legacy_profile_data()),
        [],
    );
    const fallback_profile_data = initial_profile_store.profiles[0].data;
    const [stored_profile_store, set_stored_profile_store] = useLocalStorage(
        PROFILE_STORE_KEY,
        initial_profile_store,
    );

    const profile_store = useMemo(
        () => sanitize_profile_store(stored_profile_store, fallback_profile_data),
        [stored_profile_store, fallback_profile_data],
    );
    const previous_active_profile_name_ref = useRef(profile_store.active_profile_name);
    const should_clear_filter_url_ref = useRef(false);

    useEffect(() => {
        if (!are_equal(stored_profile_store, profile_store)) {
            set_stored_profile_store(profile_store);
        }
    }, [stored_profile_store, profile_store, set_stored_profile_store]);

    const active_profile =
        profile_store.profiles.find(
            profile => profile.name === profile_store.active_profile_name,
        ) ?? profile_store.profiles[0];

    useEffect(() => {
        if (previous_active_profile_name_ref.current === profile_store.active_profile_name) {
            return;
        }
        previous_active_profile_name_ref.current = profile_store.active_profile_name;

        if (!should_clear_filter_url_ref.current) {
            return;
        }
        should_clear_filter_url_ref.current = false;

        const search_params = new URLSearchParams(location.search);
        if (!search_params.has(FILTER_URL_PARAM)) {
            return;
        }

        search_params.delete(FILTER_URL_PARAM);
        const next_search = search_params.toString();
        navigate(
            {
                pathname: location.pathname,
                search: next_search ? `?${next_search}` : "",
                hash: location.hash,
            },
            { replace: true },
        );
    }, [
        profile_store.active_profile_name,
        location.pathname,
        location.search,
        location.hash,
        navigate,
    ]);

    function update_profile_store(value_or_setter) {
        set_stored_profile_store(current_store => {
            const latest_store = read_profile_store_snapshot(current_store);
            const current = sanitize_profile_store(latest_store, fallback_profile_data);
            return sanitize_profile_store(
                apply_setter_value(current, value_or_setter),
                fallback_profile_data,
            );
        });
    }

    function set_active_profile_name(name) {
        if (
            name !== profile_store.active_profile_name &&
            profile_store.profiles.some(profile => profile.name === name)
        ) {
            should_clear_filter_url_ref.current = true;
        }

        update_profile_store(store => {
            if (!store.profiles.some(profile => profile.name === name)) {
                return store;
            }

            return {
                ...store,
                active_profile_name: name,
            };
        });
    }

    function create_profile(name, data = active_profile.data) {
        should_clear_filter_url_ref.current = true;

        update_profile_store(store => {
            const profile_name = make_unique_profile_name(name, store.profiles);
            return {
                ...store,
                active_profile_name: profile_name,
                profiles: [
                    ...store.profiles,
                    {
                        name: profile_name,
                        data: sanitize_profile_data(data),
                    },
                ],
            };
        });
    }

    function rename_profile(current_name, requested_name) {
        update_profile_store(store => {
            if (!store.profiles.some(profile => profile.name === current_name)) {
                return store;
            }

            const next_name = make_unique_profile_name(
                requested_name,
                store.profiles,
                current_name,
            );

            return {
                ...store,
                active_profile_name:
                    store.active_profile_name === current_name
                        ? next_name
                        : store.active_profile_name,
                profiles: store.profiles.map(profile =>
                    profile.name === current_name ? { ...profile, name: next_name } : profile,
                ),
            };
        });
    }

    function delete_profile(name) {
        if (name === profile_store.active_profile_name && profile_store.profiles.length > 1) {
            should_clear_filter_url_ref.current = true;
        }

        update_profile_store(store => {
            if (store.profiles.length <= 1) {
                return store;
            }

            const profiles = store.profiles.filter(profile => profile.name !== name);
            if (profiles.length === store.profiles.length) {
                return store;
            }

            return {
                ...store,
                active_profile_name:
                    store.active_profile_name === name
                        ? profiles[0].name
                        : store.active_profile_name,
                profiles,
            };
        });
    }

    function update_active_profile_data(value_or_setter) {
        update_profile_store(store => ({
            ...store,
            profiles: store.profiles.map(profile =>
                profile.name === store.active_profile_name
                    ? {
                          ...profile,
                          data: sanitize_profile_data(
                              apply_setter_value(profile.data, value_or_setter),
                          ),
                      }
                    : profile,
            ),
        }));
    }

    function update_active_profile_section(section, value_or_setter) {
        update_active_profile_data(data => ({
            ...data,
            [section]: apply_setter_value(data[section], value_or_setter),
        }));
    }

    return (
        <ProfilesContext.Provider
            value={{
                profile_store,
                profiles: profile_store.profiles,
                active_profile,
                active_profile_name: profile_store.active_profile_name,
                active_profile_data: active_profile.data,
                set_active_profile_name,
                create_profile,
                rename_profile,
                delete_profile,
                update_active_profile_data,
                update_active_profile_section,
            }}
        >
            {children}
        </ProfilesContext.Provider>
    );
}

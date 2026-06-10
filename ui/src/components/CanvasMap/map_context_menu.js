export const MAP_FILTER_ACTIONS = [
    {
        action: "alert",
        add_label: target_label => (target_label ? `Add Alert for ${target_label}` : "Add Alert"),
        remove_label: target_label =>
            target_label ? `Remove Alert for ${target_label}` : "Remove Alert",
    },
    {
        action: "show_only",
        add_label: target_label =>
            target_label ? `Add Show Only ${target_label}` : "Add Show Only",
        remove_label: target_label =>
            target_label ? `Remove Show Only ${target_label}` : "Remove Show Only",
    },
    {
        action: "hide",
        add_label: target_label => (target_label ? `Add Hide ${target_label}` : "Add Hide"),
        remove_label: target_label =>
            target_label ? `Remove Hide ${target_label}` : "Remove Hide",
    },
];

export function build_map_context_filter(action, menu_type, entity, number, system) {
    if (menu_type === "dxcc") {
        return {
            action,
            type: "entity",
            value: entity,
            spotter_or_dx: "dx",
        };
    }

    return {
        action,
        type: "zone",
        value: number,
        zone_system: system,
        spotter_or_dx: "dx",
    };
}

export function build_filter_menu_actions(
    MAP_FILTER_ACTIONS,
    build_candidate_filter,
    target_label,
    disabled,
    disabled_reason,
    get_filter_add_status,
    add_filter_if_allowed,
) {
    return MAP_FILTER_ACTIONS.map(action_config => {
        const build_filter = () => build_candidate_filter(action_config.action);
        const get_candidate_status = () => get_filter_add_status(build_filter());

        return {
            label: () =>
                !disabled && get_candidate_status().status === "remove"
                    ? action_config.remove_label(target_label)
                    : action_config.add_label(target_label),
            disabled,
            disabled_reason,
            onClick: () => {
                add_filter_if_allowed(build_filter());
            },
        };
    });
}

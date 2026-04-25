import Modal from "@/components/ui/Modal.jsx";
import Select from "@/components/ui/Select.jsx";
import Input from "@/components/ui/Input.jsx";
import CallsignInput from "@/components/CallsignInput.jsx";
import { useColors } from "@/hooks/useColors";
import { useFilters } from "@/hooks/useFilters";
import { get_valid_zone_numbers, is_valid_zone_number } from "@/utils/zones.js";
import entities from "@/assets/dxcc_entities.json";

import { default as SearchSelect } from "react-select";
import { useEffect, useState } from "react";

const dxcc_entities = entities.map(entity => ({ value: entity, label: entity }));

export const empty_filter_data = {
    action: "show_only",
    type: "prefix",
    value: "",
    spotter_or_dx: "dx",
    zone_system: "cq",
};

function RadioButton({ children, disabled, on_click }) {
    let classes = [
        "flex",
        "border",
        "border-gray-700",
        "items-center",
        "justify-center",
        "px-2",
        "h-8",
        "rounded-md",
        "mr-2",
        "text-white",
        "font-bold",
        "cursor-pointer",
        "select-none",
    ];
    let color = disabled ? "gray" : "green";
    classes = [...classes, `bg-${color}-600`, `active:bg-${color}-800`, `hover:bg-${color}-700`];
    return (
        <div className={classes.join(" ")} onClick={on_click}>
            {children}
        </div>
    );
}

function SelectionLine({ states, field, temp_data, set_temp_data, build_temp_data = null }) {
    if (build_temp_data == null) {
        build_temp_data = (temp_data, field, value) => {
            return { ...temp_data, [field]: value };
        };
    }
    return (
        <div className="flex flex-wrap justify-start items-center gap-y-2">
            {states.map(state => {
                return (
                    <label key={state.value}>
                        <RadioButton
                            color="green"
                            disabled={temp_data[field] !== state.value}
                            on_click={event =>
                                set_temp_data(build_temp_data(temp_data, field, state.value))
                            }
                        >
                            {state.label}
                        </RadioButton>
                    </label>
                );
            })}
        </div>
    );
}

function normalize_filter(filter) {
    const normalized_filter = {
        action: filter.action,
        type: filter.type,
        value: (filter.value ?? "").toString().trim().toLowerCase(),
    };

    if (filter.type == "prefix" || filter.type == "suffix" || filter.type == "entity") {
        normalized_filter.spotter_or_dx = filter.spotter_or_dx;
    }

    if (filter.type == "zone") {
        normalized_filter.zone_system = filter.zone_system || "cq";
    }

    return normalized_filter;
}

function are_same_filter(filter_a, filter_b) {
    const normalized_filter_a = normalize_filter(filter_a);
    const normalized_filter_b = normalize_filter(filter_b);

    if (
        normalized_filter_a.action != normalized_filter_b.action ||
        normalized_filter_a.type != normalized_filter_b.type
    ) {
        return false;
    }

    if (
        normalized_filter_a.type == "prefix" ||
        normalized_filter_a.type == "suffix" ||
        normalized_filter_a.type == "entity"
    ) {
        return (
            normalized_filter_a.spotter_or_dx == normalized_filter_b.spotter_or_dx &&
            normalized_filter_a.value == normalized_filter_b.value
        );
    }

    if (normalized_filter_a.type == "zone") {
        return (
            normalized_filter_a.zone_system == normalized_filter_b.zone_system &&
            normalized_filter_a.value == normalized_filter_b.value
        );
    }

    if (normalized_filter_a.type == "comment") {
        return normalized_filter_a.value == normalized_filter_b.value;
    }

    return true;
}

function are_same_filter_criteria(filter_a, filter_b) {
    const normalized_filter_a = normalize_filter(filter_a);
    const normalized_filter_b = normalize_filter(filter_b);

    if (normalized_filter_a.type != normalized_filter_b.type) {
        return false;
    }

    if (
        normalized_filter_a.type == "prefix" ||
        normalized_filter_a.type == "suffix" ||
        normalized_filter_a.type == "entity"
    ) {
        return (
            normalized_filter_a.spotter_or_dx == normalized_filter_b.spotter_or_dx &&
            normalized_filter_a.value == normalized_filter_b.value
        );
    }

    if (normalized_filter_a.type == "zone") {
        return (
            normalized_filter_a.zone_system == normalized_filter_b.zone_system &&
            normalized_filter_a.value == normalized_filter_b.value
        );
    }

    if (normalized_filter_a.type == "comment") {
        return normalized_filter_a.value == normalized_filter_b.value;
    }

    return true;
}

function get_conflicting_action(action) {
    if (action == "show_only") return "hide";
    if (action == "hide") return "show_only";
    return null;
}

function FilterModal({ initial_data = null, on_apply, button, exclude_filter_index = null }) {
    const [temp_data, set_temp_data] = useState(empty_filter_data);
    const [error_message, set_error_message] = useState("");
    const { colors } = useColors();
    const { callsign_filters } = useFilters();
    const valid_zone_numbers = get_valid_zone_numbers(temp_data.zone_system || "cq");
    const parsed_zone_value = Number.parseInt(temp_data.value, 10);
    const selected_zone_value = valid_zone_numbers.includes(parsed_zone_value)
        ? String(parsed_zone_value)
        : String(valid_zone_numbers[0] ?? "");

    useEffect(() => {
        if (error_message.length > 0) {
            set_error_message("");
        }
    }, [temp_data]);

    return (
        <Modal
            title={
                <>
                    <h1 className="text-2xl">Filter:</h1>
                    <div className="px-4">
                        <SelectionLine
                            states={[
                                { label: "Alert", value: "alert" },
                                { label: "Show Only", value: "show_only" },
                                { label: "Hide", value: "hide" },
                            ]}
                            field="action"
                            temp_data={temp_data}
                            set_temp_data={set_temp_data}
                        />
                    </div>
                </>
            }
            button={button}
            on_open={() => {
                set_error_message("");
                if (initial_data != null) {
                    set_temp_data(initial_data);
                }
            }}
            on_apply={() => {
                const draft_filter =
                    temp_data.type == "zone"
                        ? { ...temp_data, value: Number.parseInt(temp_data.value, 10) }
                        : temp_data;

                if (temp_data.type == "zone") {
                    if (!is_valid_zone_number(temp_data.zone_system, temp_data.value)) {
                        set_error_message("Please choose a valid zone.");
                        return false;
                    }
                }

                const is_value_required =
                    temp_data.type != "self_spotters" &&
                    temp_data.type != "dxpeditions" &&
                    temp_data.type != "zone";
                if (is_value_required && temp_data.value.toString().trim().length == 0) {
                    set_error_message("Please enter a filter value.");
                    return false;
                }

                const is_duplicate = callsign_filters.filters.some((filter, filter_index) => {
                    if (exclude_filter_index != null && filter_index == exclude_filter_index) {
                        return false;
                    }
                    return are_same_filter(filter, draft_filter);
                });

                if (is_duplicate) {
                    set_error_message("This filter already exists in this section.");
                    return false;
                }

                const conflicting_action = get_conflicting_action(draft_filter.action);
                if (conflicting_action != null) {
                    const is_conflicting = callsign_filters.filters.some((filter, filter_index) => {
                        if (exclude_filter_index != null && filter_index == exclude_filter_index) {
                            return false;
                        }
                        return (
                            filter.action == conflicting_action &&
                            are_same_filter_criteria(filter, draft_filter)
                        );
                    });

                    if (is_conflicting) {
                        set_error_message(
                            `This filter conflicts with an existing ${conflicting_action.replace("_", " ")} filter.`,
                        );
                        return false;
                    }
                }

                on_apply(draft_filter);
                set_error_message("");
                set_temp_data(empty_filter_data);
                return true;
            }}
            on_cancel={() => {
                set_error_message("");
                set_temp_data(empty_filter_data);
            }}
        >
            <div className="space-y-2 p-2 pb-4 w-96">
                <SelectionLine
                    states={[
                        { label: "Prefix", value: "prefix" },
                        { label: "Suffix", value: "suffix" },
                        { label: "Entity", value: "entity" },
                        { label: "Zone", value: "zone" },
                        { label: "Comment", value: "comment" },
                        { label: "Self Spotters", value: "self_spotters" },
                        { label: "DXpeditions", value: "dxpeditions" },
                    ]}
                    field="type"
                    temp_data={temp_data}
                    set_temp_data={set_temp_data}
                    build_temp_data={(temp_data, field, value) => {
                        if (value == "entity" || temp_data.type == "entity") {
                            return { ...temp_data, [field]: value, value: "" };
                        } else if (value == "zone") {
                            return {
                                ...temp_data,
                                [field]: value,
                                value: "1",
                                zone_system: temp_data.zone_system || "cq",
                                spotter_or_dx: "dx",
                            };
                        } else {
                            return { ...temp_data, [field]: value };
                        }
                    }}
                />

                {temp_data.type == "zone" ? (
                    <>
                        <hr />
                        <SelectionLine
                            states={[
                                { label: "CQ", value: "cq" },
                                { label: "ITU", value: "itu" },
                            ]}
                            field="zone_system"
                            temp_data={temp_data}
                            set_temp_data={set_temp_data}
                            build_temp_data={(current_data, field, system_value) => {
                                const zones = get_valid_zone_numbers(system_value);
                                const parsed_zone = Number.parseInt(current_data.value, 10);
                                const next_zone = zones.includes(parsed_zone)
                                    ? parsed_zone
                                    : (zones[0] ?? "");
                                return {
                                    ...current_data,
                                    [field]: system_value,
                                    value: String(next_zone),
                                    spotter_or_dx: "dx",
                                };
                            }}
                        />
                        <div className="flex justify-start space-x-5 items-center w-full">
                            <div>zone:</div>
                            <div>
                                <Select
                                    value={selected_zone_value}
                                    className="h-10 w-40"
                                    onChange={event => {
                                        set_temp_data({
                                            ...temp_data,
                                            value: event.target.value,
                                            spotter_or_dx: "dx",
                                        });
                                    }}
                                >
                                    {valid_zone_numbers.map(zone_number => (
                                        <option key={zone_number} value={zone_number}>
                                            {zone_number}
                                        </option>
                                    ))}
                                </Select>
                            </div>
                        </div>
                    </>
                ) : temp_data.type != "self_spotters" &&
                  temp_data.type != "dxpeditions" &&
                  temp_data.type != "comment" ? (
                    <>
                        <hr />
                        <SelectionLine
                            states={[
                                { label: "DX", value: "dx" },
                                { label: "Spotter", value: "spotter" },
                            ]}
                            field="spotter_or_dx"
                            temp_data={temp_data}
                            set_temp_data={set_temp_data}
                        />
                        <div className="flex justify-start space-x-5 items-center w-96">
                            <div>{temp_data.type}:</div>
                            <div>
                                {temp_data.type == "entity" ? (
                                    <SearchSelect
                                        className="h-10 w-20"
                                        value={{ value: temp_data.value, label: temp_data.value }}
                                        onChange={option => {
                                            set_temp_data({
                                                ...temp_data,
                                                value: option.value,
                                            });
                                        }}
                                        styles={{
                                            control: (base_style, state) => ({
                                                ...base_style,
                                                backgroundColor: colors.theme.input_background,
                                                borderColor: colors.theme.borders,
                                                color: colors.theme.text,
                                                width: "16rem",
                                            }),
                                            menu: (base_style, state) => ({
                                                ...base_style,
                                                backgroundColor: colors.theme.input_background,
                                                borderColor: colors.theme.borders,
                                                width: "16rem",
                                            }),
                                            option: (base_style, { isFocused }) => ({
                                                ...base_style,
                                                backgroundColor: isFocused
                                                    ? colors.theme.disabled_text
                                                    : colors.theme.input_background,
                                                color: colors.theme.text,
                                            }),
                                            input: (base_style, state) => ({
                                                ...base_style,
                                                color: colors.theme.text,
                                            }),
                                            singleValue: (base_style, state) => ({
                                                ...base_style,
                                                color: colors.theme.text,
                                            }),
                                        }}
                                        options={dxcc_entities}
                                    />
                                ) : (
                                    <CallsignInput
                                        value={temp_data.value}
                                        autoFocus={true}
                                        className="h-10"
                                        onChange={event => {
                                            set_temp_data({
                                                ...temp_data,
                                                value: event.target.value,
                                            });
                                        }}
                                    />
                                )}
                            </div>
                        </div>
                    </>
                ) : temp_data.type == "comment" ? (
                    <>
                        <hr />
                        <div className="flex justify-start space-x-5 items-center w-full">
                            <div>text:</div>
                            <div>
                                <Input
                                    value={temp_data.value}
                                    autoFocus={true}
                                    className="h-10 w-40"
                                    onChange={event => {
                                        set_temp_data({
                                            ...temp_data,
                                            value: event.target.value,
                                        });
                                    }}
                                />
                            </div>
                        </div>
                    </>
                ) : (
                    ""
                )}

                {error_message.length > 0 ? (
                    <div className="px-1 text-sm font-semibold text-red-400">{error_message}</div>
                ) : null}
            </div>
        </Modal>
    );
}

export default FilterModal;

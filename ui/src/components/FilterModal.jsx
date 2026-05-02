import Modal from "@/components/ui/Modal.jsx";
import Select from "@/components/ui/Select.jsx";
import Input from "@/components/ui/Input.jsx";
import CallsignInput from "@/components/CallsignInput.jsx";
import { useColors } from "@/hooks/useColors";
import { useFilters } from "@/hooks/useFilters";
import {
    get_valid_zone_values,
    is_valid_zone_number,
    normalize_zone_value,
} from "@/utils/zones.js";
import { STATES } from "@/data/states.js";
import entities from "@/data/dxcc_entities.json";

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

function FilterModal({ initial_data = null, on_apply, button, exclude_filter_index = null }) {
    const [temp_data, set_temp_data] = useState(empty_filter_data);
    const [error_message, set_error_message] = useState("");
    const { colors } = useColors();
    const { get_filter_add_status } = useFilters();
    const valid_zone_numbers = get_valid_zone_values(temp_data.zone_system || "cq");
    const normalized_zone_value = normalize_zone_value(
        temp_data.zone_system || "cq",
        temp_data.value,
    );
    const selected_zone_value = valid_zone_numbers.includes(normalized_zone_value)
        ? String(normalized_zone_value)
        : String(valid_zone_numbers[0] ?? "");

    useEffect(() => {
        if (error_message.length > 0) {
            set_error_message("");
        }
    }, [temp_data]);

    function to_modal_filter_data(filter_data) {
        if (!filter_data) {
            return empty_filter_data;
        }

        if (
            filter_data.type === "zone" &&
            (filter_data.zone_system === "us_state" || filter_data.zone_system === "ca_province")
        ) {
            return {
                ...filter_data,
                type: "zone_region",
            };
        }

        return filter_data;
    }

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
                    set_temp_data(to_modal_filter_data(initial_data));
                }
            }}
            on_apply={() => {
                const draft_filter =
                    temp_data.type == "zone" || temp_data.type == "zone_region"
                        ? {
                              ...temp_data,
                              type: "zone",
                              value: normalize_zone_value(
                                  temp_data.zone_system || "cq",
                                  temp_data.value,
                              ),
                          }
                        : temp_data;

                if (temp_data.type == "zone" || temp_data.type == "zone_region") {
                    if (!is_valid_zone_number(temp_data.zone_system, temp_data.value)) {
                        set_error_message("Please choose a valid zone.");
                        return false;
                    }
                }

                const is_value_required =
                    temp_data.type != "self_spotters" &&
                    temp_data.type != "dxpeditions" &&
                    temp_data.type != "zone" &&
                    temp_data.type != "zone_region";
                if (is_value_required && temp_data.value.toString().trim().length == 0) {
                    set_error_message("Please enter a filter value.");
                    return false;
                }

                const add_status = get_filter_add_status(draft_filter, exclude_filter_index);
                if (add_status.status === "remove") {
                    set_error_message("This filter already exists in this section.");
                    return false;
                }

                if (add_status.status === "replace") {
                    set_error_message(
                        `This filter conflicts with an existing ${add_status.conflicting_action.replace("_", " ")} filter.`,
                    );
                    return false;
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
                        { label: "US/Canada", value: "zone_region" },
                        { label: "Zone", value: "zone" },
                        { label: "Comment", value: "comment" },
                        { label: "Self Spotters", value: "self_spotters" },
                        { label: "DXpeditions", value: "dxpeditions" },
                    ]}
                    field="type"
                    temp_data={temp_data}
                    set_temp_data={set_temp_data}
                    build_temp_data={(temp_data, field, value) => {
                        if (
                            value == "entity" ||
                            temp_data.type == "entity" ||
                            value == "zone_region"
                        ) {
                            return {
                                ...temp_data,
                                [field]: value,
                                value: value == "zone_region" ? "AL" : "",
                                zone_system:
                                    value == "zone_region" ? "us_state" : temp_data.zone_system,
                                spotter_or_dx: "dx",
                            };
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
                                const zones = get_valid_zone_values(system_value);
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
                ) : temp_data.type == "zone_region" ? (
                    <>
                        <hr />
                        <SelectionLine
                            states={[
                                { label: "US", value: "us_state" },
                                { label: "Canada", value: "ca_province" },
                            ]}
                            field="zone_system"
                            temp_data={temp_data}
                            set_temp_data={set_temp_data}
                            build_temp_data={(current_data, field, system_value) => {
                                const zones = get_valid_zone_values(system_value);
                                const next_zone = zones.includes(current_data.value)
                                    ? current_data.value
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
                            <div>state/province:</div>
                            <div>
                                <Select
                                    value={temp_data.value}
                                    className="h-10 w-40"
                                    onChange={event => {
                                        set_temp_data({
                                            ...temp_data,
                                            value: event.target.value,
                                            spotter_or_dx: "dx",
                                        });
                                    }}
                                >
                                    {get_valid_zone_values(temp_data.zone_system || "us_state").map(
                                        zone_number => {
                                            const state_list =
                                                temp_data.zone_system === "ca_province"
                                                    ? STATES.Canada
                                                    : STATES.USA;
                                            const region_name =
                                                state_list?.[zone_number] ?? zone_number;
                                            return (
                                                <option key={zone_number} value={zone_number}>
                                                    {zone_number} - {region_name}
                                                </option>
                                            );
                                        },
                                    )}
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

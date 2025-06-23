import Modal from "@/components/Modal.jsx";
import Select from "@/components/Select.jsx";
import Input from "@/components/Input.jsx";
import { useColors } from "../hooks/useColors";
import entities from "@/assets/dxcc_entities.json";

import { default as SearchSelect } from "react-select";
import { useState } from "react";

const dxcc_entities = entities.map(entity => ({ value: entity, label: entity }));

export const empty_filter_data = {
    action: "show_only",
    type: "prefix",
    value: "",
    spotter_or_dx: "dx",
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
        <div className="w-fit flex justify-start items-center">
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

function FilterModal({ initial_data = null, on_apply, button }) {
    const [temp_data, set_temp_data] = useState(empty_filter_data);
    const { colors } = useColors();

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
                if (initial_data != null) {
                    set_temp_data(initial_data);
                }
            }}
            on_apply={() => {
                if (temp_data.value.length > 0 || temp_data.type == "self_spotters") {
                    on_apply(temp_data);
                    set_temp_data(empty_filter_data);
                    return true;
                } else {
                    return false;
                }
            }}
            on_cancel={() => set_temp_data(empty_filter_data)}
        >
            <div className="space-y-2 p-2 pb-4">
                <SelectionLine
                    states={[
                        { label: "Prefix", value: "prefix" },
                        { label: "Suffix", value: "suffix" },
                        { label: "Entity", value: "entity" },
                        { label: "Self Spotters", value: "self_spotters" },
                    ]}
                    field="type"
                    temp_data={temp_data}
                    set_temp_data={set_temp_data}
                    build_temp_data={(temp_data, field, value) => {
                        if (value == "entity" || temp_data.type == "entity") {
                            return { ...temp_data, [field]: value, value: "" };
                        } else {
                            return { ...temp_data, [field]: value };
                        }
                    }}
                />
                {temp_data.type != "self_spotters" ? (
                    <>
                        <SelectionLine
                            states={[
                                { label: "DX", value: "dx" },
                                { label: "Spotter", value: "spotter" },
                            ]}
                            field="spotter_or_dx"
                            temp_data={temp_data}
                            set_temp_data={set_temp_data}
                        />
                        <div className="flex justify-start space-x-5 items-center w-full">
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
                                    <Input
                                        value={temp_data.value}
                                        className="uppercase h-10"
                                        onChange={event => {
                                            set_temp_data({
                                                ...temp_data,
                                                value: event.target.value.toUpperCase(),
                                            });
                                        }}
                                    />
                                )}
                            </div>
                        </div>
                    </>
                ) : (
                    ""
                )}
            </div>
        </Modal>
    );
}

export default FilterModal;

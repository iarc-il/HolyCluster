import Modal from "@/components/ui/Modal.jsx";
import Select from "@/components/ui/Select.jsx";
import Input from "@/components/ui/Input.jsx";
import CallsignInput from "@/components/CallsignInput.jsx";
import { useColors } from "@/hooks/useColors";
import { useDxcc } from "@/hooks/useDxcc";
import entities from "@/assets/dxcc_entities.json";

import { default as SearchSelect } from "react-select";
import { useState, useRef, useEffect, useCallback } from "react";

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

function TooltipLabel({ tooltip, children }) {
    const [visible, set_visible] = useState(false);
    const [pos, set_pos] = useState({ x: 0, y: 0 });

    const timer_ref = useRef(null);

    const handle_mouse_enter = useCallback(e => {
        set_pos({ x: e.clientX, y: e.clientY });
        timer_ref.current = setTimeout(() => set_visible(true), 500);
    }, []);

    const handle_mouse_move = useCallback(e => {
        set_pos({ x: e.clientX, y: e.clientY });
    }, []);

    const handle_mouse_leave = useCallback(() => {
        clearTimeout(timer_ref.current);
        set_visible(false);
    }, []);

    if (!tooltip) return <label>{children}</label>;

    return (
        <label
            onMouseEnter={handle_mouse_enter}
            onMouseMove={handle_mouse_move}
            onMouseLeave={handle_mouse_leave}
        >
            {children}
            {visible && (
                <div
                    style={{
                        position: "fixed",
                        left: pos.x + 12,
                        top: pos.y + 12,
                        backgroundColor: "#1e293b",
                        color: "#f1f5f9",
                        border: "1px solid #475569",
                        borderRadius: "6px",
                        padding: "10px 14px",
                        fontSize: "14px",
                        lineHeight: "1.6",
                        maxWidth: "260px",
                        zIndex: 9999,
                        pointerEvents: "none",
                        whiteSpace: "pre-line",
                    }}
                >
                    {tooltip}
                </div>
            )}
        </label>
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
                    <TooltipLabel key={state.value} tooltip={state.tooltip}>
                        <RadioButton
                            color="green"
                            disabled={temp_data[field] !== state.value}
                            on_click={event =>
                                set_temp_data(build_temp_data(temp_data, field, state.value))
                            }
                        >
                            {state.label}
                        </RadioButton>
                    </TooltipLabel>
                );
            })}
        </div>
    );
}

function CountryDropdown({ list, color }) {
    const [open, set_open] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        function handle_click_outside(e) {
            if (ref.current && !ref.current.contains(e.target)) {
                set_open(false);
            }
        }
        document.addEventListener("mousedown", handle_click_outside);
        return () => document.removeEventListener("mousedown", handle_click_outside);
    }, [open]);

    if (!list || list.length === 0) return null;
    return (
        <span ref={ref} className="relative inline-block">
            <span
                className="cursor-pointer underline decoration-dotted text-xl font-bold"
                style={{ color }}
                onClick={() => set_open(o => !o)}
            >
                {list.length} ▾
            </span>
            {open && (
                <div
                    className="absolute z-50 mt-1 left-0 rounded-md shadow-lg overflow-y-auto"
                    style={{ backgroundColor: "#1e293b", border: "1px solid #334155", maxHeight: "220px", minWidth: "200px" }}
                >
                    {list.map((c, i) => (
                        <div key={i} className="px-3 py-0.5 text-sm text-white hover:bg-slate-700">
                            {c}
                        </div>
                    ))}
                </div>
            )}
        </span>
    );
}

function MissingDxccPanel() {
    const { cty_ready, cty_error, dxcc_state, load_adif, clear_dxcc } = useDxcc();
    const adif_input_ref = useRef(null);

    function trigger_adif_load() {
        adif_input_ref.current.click();
    }

    function handle_adif_change(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => load_adif(ev.target.result, file.name);
        reader.readAsText(file, "utf-8");
        e.target.value = "";
    }

    if (cty_error) {
        return (
            <div className="text-sm text-red-400 mt-2">
                Failed to load DXCC database (cty.dat not found).
            </div>
        );
    }

    if (!cty_ready) {
        return <div className="text-sm text-gray-400 mt-2">Loading DXCC database…</div>;
    }

    return (
        <div className="mt-3 space-y-3">
            <input
                ref={adif_input_ref}
                type="file"
                accept=".adi,.adif"
                style={{ display: "none" }}
                onChange={handle_adif_change}
            />
            {!dxcc_state ? (
                <div className="space-y-2">
                    <p className="text-base font-semibold text-white">
                        Load your ADIF log to find unworked DXCC entities.
                    </p>
                    <button
                        type="button"
                        onClick={trigger_adif_load}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white"
                    >
                        📂 Load ADIF Log
                    </button>
                </div>
            ) : (
                <div className="space-y-2">
                    <div className="text-base font-semibold text-white">
                        <CountryDropdown list={dxcc_state.needed_list} color="#f87171" />
                        {" needed · "}
                        <CountryDropdown list={dxcc_state.worked_list} color="#4ade80" />
                        {" worked"}
                        {dxcc_state.station_call ? (
                            <span className="text-white"> · {dxcc_state.station_call}</span>
                        ) : null}
                    </div>
                    <div className="text-sm text-white flex flex-col gap-0.5">
                        {dxcc_state.loaded_files.map((f, i) => (
                            <div key={i} className="flex gap-2">
                                <span className="shrink-0 w-4">{i + 1})</span>
                                <span className="min-w-0 break-all" style={{marginLeft: "-4px"}}>{f}</span>
                            </div>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={trigger_adif_load}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white"
                        >
                            📂 Update Log
                        </button>
                        <button
                            type="button"
                            onClick={clear_dxcc}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-red-700 hover:bg-red-800 text-white"
                        >
                            ✕ Clear
                        </button>
                    </div>
                </div>
            )}
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
                if (
                    temp_data.value.length > 0 ||
                    temp_data.type == "self_spotters" ||
                    temp_data.type == "dxpeditions" ||
                    temp_data.type == "missing_dxcc"
                ) {
                    on_apply(temp_data);
                    set_temp_data(empty_filter_data);
                    return true;
                } else {
                    return false;
                }
            }}
            on_cancel={() => set_temp_data(empty_filter_data)}
        >
            <div className="space-y-2 p-2 pb-4 w-96">
                <SelectionLine
                    states={[
                        { label: "Prefix", value: "prefix" },
                        { label: "Suffix", value: "suffix" },
                        { label: "Entity", value: "entity" },
                        { label: "Comment", value: "comment" },
                        { label: "CQ Zone", value: "cq_zone" },
                        { label: "ITU Zone", value: "itu_zone" },
                        { label: "Self Spotters", value: "self_spotters" },
                        { label: "DXpeditions", value: "dxpeditions" },
                        { label: "Missing DXCC", value: "missing_dxcc", tooltip: "Load your ADIF log files.\nI will list all DXCC entities\nyou have not worked yet.\n\nAny such entity that is spotted\nwill blink on the map." },
                    ]}
                    field="type"
                    temp_data={temp_data}
                    set_temp_data={set_temp_data}
                    build_temp_data={(temp_data, field, value) => {
                        if (value == "entity" || temp_data.type == "entity") {
                            return { ...temp_data, [field]: value, value: "" };
                        } else if (value == "cq_zone" || value == "itu_zone") {
                            return { ...temp_data, [field]: value, value: "1" };
                        } else {
                            return { ...temp_data, [field]: value };
                        }
                    }}
                />

                {temp_data.type === "missing_dxcc" ? (
                    <MissingDxccPanel />
                ) : temp_data.type === "cq_zone" || temp_data.type === "itu_zone" ? (
                    <>
                        <hr />
                        <div className="flex justify-start space-x-5 items-center">
                            <div>{temp_data.type === "cq_zone" ? "CQ Zone:" : "ITU Zone:"}</div>
                            <select
                                value={temp_data.value}
                                onChange={e => set_temp_data({ ...temp_data, value: e.target.value })}
                                style={{
                                    backgroundColor: colors.theme.input_background,
                                    color: colors.theme.text,
                                    borderRadius: "0.375rem",
                                    padding: "0.25rem 0.5rem",
                                    fontSize: "1rem",
                                    border: `1px solid ${colors.theme.borders}`,
                                }}
                            >
                                {Array.from(
                                    { length: temp_data.type === "cq_zone" ? 40 : 90 },
                                    (_, i) => i + 1
                                ).map(n => (
                                    <option key={n} value={String(n)}>{n}</option>
                                ))}
                            </select>
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
            </div>
        </Modal>
    );
}

export default FilterModal;

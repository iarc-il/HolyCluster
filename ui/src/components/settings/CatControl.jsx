import Button from "@/components/ui/Button.jsx";
import Input from "@/components/ui/Input.jsx";
import Select from "@/components/ui/Select.jsx";
import Toggle from "@/components/ui/Toggle.jsx";
import { useColors } from "@/hooks/useColors";
import use_radio from "@/hooks/useRadio";
import use_rotator from "@/hooks/useRotator";
import hamlib_config_policy from "@shared/hamlib_ui_config_policy.json";
import { useEffect, useState } from "react";
import { default as SearchSelect } from "react-select";
import LoggerIntegrationHelp from "./LoggerIntegrationHelp.jsx";
import PortInput from "./PortInput.jsx";

const {
    connection_kind_by_port_type,
    network_pathname_token,
    pathname_tokens,
    serial_labels,
    serial_option_values,
} = hamlib_config_policy;

const DEFAULT_HAMLIB_MODEL_ID = "1";
const DEFAULT_UNIX_SERIAL_PORT = "/dev/ttyUSB0";
const DEFAULT_WINDOWS_SERIAL_PORT = "COM1";
const DEFAULT_BAUD_RATE = "9600";
const DEFAULT_HAMLIB_NETWORK_HOST = "127.0.0.1";
const DEFAULT_HAMLIB_NETWORK_PORT = "4532";
const DEFAULT_ROTATOR_NETWORK_PORT = "4533";

function default_serial_port(ports) {
    const port_names = ports ?? [];
    const is_windows = typeof navigator !== "undefined" && navigator.platform.startsWith("Win");
    const preferred = is_windows
        ? port_names.find(port => port.toUpperCase() === DEFAULT_WINDOWS_SERIAL_PORT)
        : port_names.find(port => /(?:^|\/)ttyUSB[^/]*$/i.test(port));
    return (
        preferred ||
        port_names[0] ||
        (is_windows ? DEFAULT_WINDOWS_SERIAL_PORT : DEFAULT_UNIX_SERIAL_PORT)
    );
}

function default_descriptor_value(descriptor, serial_ports, port_type = "serial") {
    if (pathname_tokens.includes(descriptor.token) || descriptor.token === "rot_pathname") {
        if (connection_kind_by_port_type[port_type] === "network") {
            return `${DEFAULT_HAMLIB_NETWORK_HOST}:${DEFAULT_HAMLIB_NETWORK_PORT}`;
        }
        return default_serial_port(serial_ports);
    }
    if (["serial_speed", "baud"].includes(descriptor.token)) {
        return DEFAULT_BAUD_RATE;
    }
    if (descriptor.token === "data_bits") return "8";
    if (descriptor.token === "stop_bits") return "1";
    return String(descriptor.default ?? "");
}

function normalize_numeric_value(value, descriptor, serial_ports, port_type = "serial") {
    const minimum = Number(descriptor.minimum);
    const maximum = Number(descriptor.maximum);
    const step = Number(descriptor.step);
    const fallback = Number(default_descriptor_value(descriptor, serial_ports, port_type));
    let number = Number(value);
    if (!Number.isFinite(number)) {
        number = Number.isFinite(fallback) ? fallback : minimum;
    }
    if (Number.isFinite(minimum)) number = Math.max(number, minimum);
    if (Number.isFinite(maximum)) number = Math.min(number, maximum);
    if (Number.isFinite(step) && step > 0) {
        const origin = Number.isFinite(minimum) ? minimum : 0;
        number = origin + Math.round((number - origin) / step) * step;
    }
    if (descriptor.kind === "integer") number = Math.round(number);
    return String(number);
}

function normalized_descriptor_value(descriptor, value, serial_ports, port_type = "serial") {
    const default_value = default_descriptor_value(descriptor, serial_ports, port_type);
    if (descriptor.kind === "integer" || descriptor.kind === "numeric") {
        return normalize_numeric_value(value ?? default_value, descriptor, serial_ports, port_type);
    }
    if (descriptor.kind === "combo") {
        const options = descriptor.options.map(String);
        return options.includes(String(value)) ? String(value) : default_value;
    }
    if (pathname_tokens.includes(descriptor.token) || descriptor.token === "rot_pathname") {
        return value && value !== "/dev/rig" ? String(value) : default_value;
    }
    return value == null || value === "" ? default_value : String(value);
}

function descriptor_value(descriptor, value, serial_ports, port_type) {
    return normalized_descriptor_value(descriptor, value, serial_ports, port_type);
}

function network_endpoint(value) {
    const endpoint = String(
        value || `${DEFAULT_HAMLIB_NETWORK_HOST}:${DEFAULT_HAMLIB_NETWORK_PORT}`,
    );
    const separator = endpoint.lastIndexOf(":");
    if (separator < 0) {
        return { host: endpoint, port: DEFAULT_HAMLIB_NETWORK_PORT };
    }
    return { host: endpoint.slice(0, separator), port: endpoint.slice(separator + 1) };
}

function network_pathname(host, port) {
    return `${host}:${port}`;
}

function port_error(value, minimum, label) {
    const port = Number(value);
    if (Number.isInteger(port) && port >= minimum && port <= 65535) {
        return null;
    }
    return `${label} must be a whole number between ${minimum} and 65535.`;
}

function serial_descriptors(descriptors) {
    return descriptors
        .filter(
            descriptor =>
                Object.hasOwn(serial_labels, descriptor.token) ||
                descriptor.token === "rot_pathname",
        )
        .sort(
            (left, right) =>
                Object.keys(serial_labels).indexOf(left.token) -
                Object.keys(serial_labels).indexOf(right.token),
        );
}

function empty_hamlib() {
    return { model_id: DEFAULT_HAMLIB_MODEL_ID, token_values: {} };
}

function normalize_configuration(configuration) {
    if (configuration == null) {
        return null;
    }
    const rig = configuration.rig;
    return {
        rig:
            rig?.model_id == null
                ? null
                : {
                      model_id: String(rig.model_id),
                      token_values: { ...(rig.token_values || {}) },
                  },
    };
}

function materialized_hamlib(rig, descriptors, serial_ports, port_type) {
    const token_values = { ...rig.hamlib.token_values };
    if (connection_kind_by_port_type[port_type] === "none") {
        for (const token of [...pathname_tokens, "rot_pathname"]) {
            delete token_values[token];
        }
    }
    for (const descriptor of descriptors.filter(
        descriptor =>
            (Object.hasOwn(serial_labels, descriptor.token) ||
                descriptor.token === "rot_pathname") &&
            !(
                connection_kind_by_port_type[port_type] === "none" &&
                (pathname_tokens.includes(descriptor.token) || descriptor.token === "rot_pathname")
            ),
    )) {
        token_values[descriptor.token] = normalized_descriptor_value(
            descriptor,
            token_values[descriptor.token],
            serial_ports,
            port_type,
        );
    }
    return { ...rig.hamlib, token_values };
}

function materialized_radio(rig, descriptors, serial_ports, connection_kind) {
    if (rig == null) return null;
    if (connection_kind === "none") {
        return { ...rig, token_values: {} };
    }
    const wrapper = { hamlib: rig };
    return materialized_hamlib(wrapper, descriptors, serial_ports, connection_kind);
}

function radio_model_options(models) {
    return models.map(model => ({
        value: model.id,
        label: `${model.manufacturer} ${model.model}`,
        connection_kind: model.connection_kind,
    }));
}

function hamlib_model_options(models) {
    return models.map(model => ({
        value: model.id,
        label: `${model.manufacturer} ${model.model}`,
        port_type: model.port_type,
        isDisabled: model.enabled === false,
        disabled_reason: model.disabled_reason,
    }));
}

function serial_port_options(ports, current_value) {
    const options = ports.map(port => ({ value: port, label: port }));
    if (current_value && !options.some(option => option.value === current_value)) {
        options.unshift({ value: current_value, label: current_value });
    }
    return options;
}

function search_filter(option, text) {
    return `${option.label} ${option.value}`.toLowerCase().includes(text.toLowerCase());
}

function search_select_styles(colors, invalid = false) {
    return {
        control: base_style => ({
            ...base_style,
            backgroundColor: colors.theme.input_background,
            borderColor: invalid ? "#fecaca" : colors.theme.borders,
            color: colors.theme.text,
            minHeight: "2.5rem",
        }),
        menu: base_style => ({
            ...base_style,
            backgroundColor: colors.theme.input_background,
            borderColor: colors.theme.borders,
        }),
        option: (base_style, { isFocused }) => ({
            ...base_style,
            backgroundColor: isFocused ? colors.theme.disabled_text : colors.theme.input_background,
            color: colors.theme.text,
        }),
        input: base_style => ({
            ...base_style,
            color: colors.theme.text,
        }),
        singleValue: base_style => ({
            ...base_style,
            color: colors.theme.text,
        }),
    };
}

function select_options(descriptor, value) {
    const options = serial_option_values[descriptor.token] ?? descriptor.options;
    if (options == null) {
        return null;
    }

    const values = options.map(String);
    if (value && !values.includes(value)) {
        values.unshift(value);
    }
    return values;
}

function error_matches(errors, field, token = null) {
    return errors.some(error => error.field === field || (token != null && error.token === token));
}

function error_text(error) {
    const field = error.token == null ? error.field : `${error.field} (${error.token})`;
    return `${field}: ${error.message}`;
}

function DescriptorInput({ descriptor, value, on_change, error_tokens, colors, serial_ports }) {
    const input_id = `hamlib-${descriptor.token}`;
    const invalid = error_tokens.includes(descriptor.token);
    const label =
        descriptor.token === "rot_pathname"
            ? "Serial port"
            : serial_labels[descriptor.token] || descriptor.label;
    const input_class = invalid ? "bg-red-200" : "";
    const options = select_options(descriptor, value);

    if (label === "Serial port") {
        const options = serial_port_options(serial_ports ?? [], value);
        return (
            <label className="flex flex-col gap-1" title={descriptor.tooltip} htmlFor={input_id}>
                <span>{label}</span>
                <SearchSelect
                    inputId={input_id}
                    aria-label={label}
                    className="w-full"
                    filterOption={search_filter}
                    value={options.find(option => option.value === value) ?? null}
                    placeholder="Select a serial port"
                    onChange={option => on_change(option?.value ?? "")}
                    styles={search_select_styles(colors, invalid)}
                    options={options}
                />
            </label>
        );
    }

    if (descriptor.kind === "boolean") {
        return (
            <label
                className="flex items-center gap-2"
                title={descriptor.tooltip}
                htmlFor={input_id}
            >
                <input
                    id={input_id}
                    checked={value === "true"}
                    type="checkbox"
                    onChange={event => on_change(String(event.target.checked))}
                />
                {label}
            </label>
        );
    }

    return (
        <label className="flex flex-col gap-1" title={descriptor.tooltip} htmlFor={input_id}>
            <span>{label}</span>
            {options ? (
                <Select
                    id={input_id}
                    aria-invalid={invalid}
                    className={input_class}
                    value={value}
                    onChange={event => on_change(event.target.value)}
                >
                    {options.map(option => (
                        <option key={option} value={option}>
                            {option}
                        </option>
                    ))}
                </Select>
            ) : (
                <Input
                    id={input_id}
                    aria-invalid={invalid}
                    className={input_class}
                    type={
                        descriptor.kind === "integer" || descriptor.kind === "numeric"
                            ? "number"
                            : "text"
                    }
                    min={descriptor.minimum}
                    max={descriptor.maximum}
                    step={descriptor.step}
                    value={value}
                    onChange={event => on_change(event.target.value)}
                    onBlur={
                        descriptor.kind === "integer" || descriptor.kind === "numeric"
                            ? () =>
                                  on_change(
                                      normalize_numeric_value(value, descriptor, serial_ports),
                                  )
                            : undefined
                    }
                />
            )}
        </label>
    );
}

function CatControl({
    temp_settings,
    set_temp_settings,
    colors: fallback_colors,
    radio_config_apply_ref = null,
}) {
    const { colors: theme_colors } = useColors();
    const colors = theme_colors ?? fallback_colors;
    const {
        radio_capabilities,
        radio_configuration_support,
        radio_configuration,
        radio_configuration_result,
        radio_connection_result,
        radio_models,
        radio_models_error,
        serial_ports,
        serial_ports_error,
        radio_model_details,
        radio_model_error,
        get_radio_configuration,
        list_radio_models,
        list_serial_ports,
        describe_radio_model,
        set_radio_configuration,
        test_radio_connection,
    } = use_radio();
    const {
        rotator_models,
        rotator_model_details,
        rotator_configuration,
        rotator_configuration_result,
        rotator_connection_result,
        list_rotator_models,
        describe_rotator_model,
        get_rotator_configuration,
        apply_rotator_configuration,
        test_rotator_connection,
    } = use_rotator() ?? {
        rotator_models: [],
        rotator_model_details: {},
        rotator_configuration: null,
        rotator_configuration_result: null,
        rotator_connection_result: null,
        list_rotator_models: () => {},
        describe_rotator_model: () => {},
        get_rotator_configuration: () => {},
        apply_rotator_configuration: () => Promise.resolve({ ok: false }),
        test_rotator_connection: () => {},
    };
    const [configuration, set_configuration] = useState(null);
    const [rotator_form, set_rotator_form] = useState(null);
    const [rotator_save_state, set_rotator_save_state] = useState(null);
    const [save_state, set_save_state] = useState(null);
    const [logger_port_touched, set_logger_port_touched] = useState(false);
    const configuration_capable = radio_configuration_support === "supported";
    const rotator_configuration_capable = radio_capabilities?.rotator_configuration === true;
    const selected_configuration = configuration?.rig;
    const server_errors =
        radio_configuration_result?.failure === "invalid_config"
            ? radio_configuration_result.errors || []
            : [];
    const radio_result = radio_connection_result ?? radio_configuration_result;
    const radio_errors =
        radio_result?.failure === "invalid_config" ? radio_result.errors || [] : [];
    const has_field_errors = radio_result?.failure === "invalid_config" && radio_errors.length > 0;
    const selected_errors = radio_errors.filter(error => error.field?.startsWith("rig"));
    const model_options = radio_model_options(radio_models);
    const rotator_model_options = hamlib_model_options(rotator_models);
    const selected_rotator_model = rotator_model_options.find(
        option => option.value === rotator_form?.hamlib?.model_id,
    );
    const selected_rotator_descriptors =
        rotator_model_details[rotator_form?.hamlib?.model_id] || [];
    const rotator_network_default =
        selected_rotator_descriptors.find(descriptor => descriptor.token === "rot_pathname")
            ?.default || `${DEFAULT_HAMLIB_NETWORK_HOST}:${DEFAULT_ROTATOR_NETWORK_PORT}`;
    const rotator_connection_kind =
        connection_kind_by_port_type[selected_rotator_model?.port_type] || "serial";
    const selected_model = model_options.find(
        option => option.value === selected_configuration?.model_id,
    );
    const selected_connection_kind = selected_model?.connection_kind || "none";
    const radio_port_value =
        selected_connection_kind === "network"
            ? network_endpoint(selected_configuration.token_values[network_pathname_token]).port
            : null;
    const radio_port_server_error = selected_errors.find(
        error => error.token === network_pathname_token,
    )?.message;
    const radio_port_error =
        radio_port_server_error ||
        (selected_connection_kind === "network" ? port_error(radio_port_value, 1, "Port") : null);
    const rotator_port_value =
        rotator_connection_kind === "network"
            ? network_endpoint(
                  rotator_form.hamlib.token_values.rot_pathname || rotator_network_default,
              ).port
            : null;
    const rotator_port_error =
        rotator_connection_kind === "network" ? port_error(rotator_port_value, 1, "Port") : null;
    const logger_port_error = logger_port_touched
        ? port_error(temp_settings.highlight_port, 1024, "UDP port")
        : null;
    const radio_feedback = radio_port_error
        ? { ok: false, message: radio_port_error }
        : has_field_errors
          ? { ok: false, message: radio_errors.map(error_text).join(" ") }
          : save_state;
    const rotator_feedback = rotator_port_error
        ? { ok: false, message: rotator_port_error }
        : rotator_save_state;

    useEffect(() => {
        if (configuration_capable) {
            get_radio_configuration();
            list_radio_models();
            list_serial_ports();
        }
    }, [configuration_capable]);

    useEffect(() => {
        set_configuration(normalize_configuration(radio_configuration));
    }, [radio_configuration]);

    useEffect(() => {
        if (rotator_configuration_capable) {
            get_rotator_configuration();
            list_rotator_models();
            list_serial_ports();
        }
    }, [rotator_configuration_capable]);

    useEffect(() => {
        if (rotator_configuration == null) return;
        set_rotator_form({
            backend: rotator_configuration.backend || "unconfigured",
            hamlib: {
                model_id: rotator_configuration.hamlib?.model_id || DEFAULT_HAMLIB_MODEL_ID,
                token_values: rotator_configuration.hamlib?.token_values || {},
            },
        });
    }, [rotator_configuration]);

    useEffect(() => {
        if (rotator_form?.backend === "hamlib" && rotator_form.hamlib.model_id) {
            describe_rotator_model(rotator_form.hamlib.model_id);
        }
    }, [rotator_form?.backend, rotator_form?.hamlib?.model_id]);

    useEffect(() => {
        const result = rotator_connection_result ?? rotator_configuration_result;
        if (result?.ok === true) {
            set_rotator_save_state({ ok: true, message: "Rotator operation succeeded." });
        } else if (result?.ok === false) {
            set_rotator_save_state({
                ok: false,
                message: result.errors?.[0]?.message || "Rotator operation failed.",
            });
        }
    }, [rotator_configuration_result, rotator_connection_result]);

    useEffect(() => {
        if (selected_configuration?.model_id) {
            describe_radio_model(selected_configuration.model_id);
        }
    }, [selected_configuration?.model_id]);

    useEffect(() => {
        if (radio_configuration_result?.ok === true) {
            set_save_state({ ok: true, message: "Radio hardware saved." });
        } else if (radio_configuration_result?.failure === "invalid_config") {
            set_save_state({
                ok: false,
                message: "Fix the highlighted radio settings before applying.",
            });
        } else if (radio_configuration_result?.failure === "connection") {
            const connection_error = radio_configuration_result.errors?.find(
                error => error.field === "connection" || error.field === "backend",
            );
            set_save_state({
                ok: false,
                message: connection_error?.message || "Radio connection failed.",
                details:
                    radio_configuration_result.errors
                        ?.map(error => error.details)
                        .filter(Boolean)
                        .join("\n\n") || undefined,
            });
        }
    }, [radio_configuration_result]);

    useEffect(() => {
        if (radio_connection_result?.ok === true) {
            set_save_state({ ok: true, message: "Radio connection succeeded." });
        } else if (radio_connection_result?.failure === "connection") {
            const errors = radio_connection_result.errors || [];
            const connection_error = errors.find(error => error.field === "connection");
            set_save_state({
                ok: false,
                message:
                    connection_error?.message ||
                    (errors.length > 0
                        ? "Fix the highlighted radio settings."
                        : "Radio connection failed."),
                details:
                    errors
                        .map(error => error.details)
                        .filter(Boolean)
                        .join("\n\n") || undefined,
            });
        }
    }, [radio_connection_result]);

    function update_selected(update) {
        set_save_state(null);
        set_configuration(current => ({ ...current, rig: update(current.rig) }));
    }

    function serialized_configuration() {
        const rig = configuration.rig;
        return {
            rig: materialized_radio(
                rig,
                rig == null ? [] : radio_model_details[rig.model_id] || [],
                serial_ports,
                selected_connection_kind,
            ),
        };
    }

    async function save_configuration() {
        set_save_state({ ok: null, message: "Saving radio hardware..." });
        const result = await set_radio_configuration(serialized_configuration());
        return result.ok;
    }

    function test_connection() {
        set_save_state({ ok: null, message: "Testing radio connection..." });
        test_radio_connection(serialized_configuration());
    }

    function serialized_rotator_configuration() {
        if (rotator_form.backend !== "hamlib") {
            return { backend: "unconfigured" };
        }
        const form = {
            ...rotator_form,
            hamlib: {
                ...rotator_form.hamlib,
                token_values: {
                    ...rotator_form.hamlib.token_values,
                    ...(rotator_connection_kind === "network" &&
                    !rotator_form.hamlib.token_values.rot_pathname
                        ? {
                              rot_pathname: rotator_network_default,
                          }
                        : {}),
                },
            },
        };
        return {
            backend: "hamlib",
            hamlib: materialized_hamlib(
                form,
                selected_rotator_descriptors,
                serial_ports,
                selected_rotator_model?.port_type,
            ),
        };
    }

    function save_rotator_configuration() {
        set_rotator_save_state({ ok: null, message: "Saving rotator hardware..." });
        apply_rotator_configuration(serialized_rotator_configuration());
    }

    function test_rotator() {
        set_rotator_save_state({ ok: null, message: "Testing rotator connection..." });
        test_rotator_connection(serialized_rotator_configuration());
    }

    if (radio_config_apply_ref != null) {
        radio_config_apply_ref.current = configuration == null ? null : save_configuration;
    }

    return (
        <div className="p-4" data-tour="settings-cat-control">
            {radio_configuration_support === "update_required" ? (
                <p role="alert" className="mb-6">
                    Update the CAT server to configure radio hardware.
                </p>
            ) : null}
            {configuration_capable && configuration != null ? (
                <section className="mb-6 flex flex-col gap-4" aria-label="Radio hardware settings">
                    <h4 className="text-lg">Radio hardware</h4>
                    <div className="flex flex-col gap-3">
                        {radio_models_error ? (
                            <p role="alert">{radio_models_error.message}</p>
                        ) : null}
                        {serial_ports_error ? (
                            <p role="alert">{serial_ports_error.message}</p>
                        ) : null}
                        <label className="flex flex-col gap-1" htmlFor="hamlib-model">
                            <span>Model</span>
                            <SearchSelect
                                inputId="hamlib-model"
                                aria-label="Model"
                                className="w-full"
                                filterOption={search_filter}
                                value={selected_model ?? null}
                                placeholder="Select a model"
                                onChange={option => {
                                    const model_id = option?.value;
                                    update_selected(rig =>
                                        model_id == null
                                            ? null
                                            : {
                                                  model_id,
                                                  token_values:
                                                      model_id === rig?.model_id
                                                          ? rig.token_values
                                                          : {},
                                              },
                                    );
                                }}
                                styles={search_select_styles(
                                    colors,
                                    error_matches(radio_errors, "rig.model_id"),
                                )}
                                options={model_options}
                            />
                        </label>
                        {selected_configuration != null && selected_connection_kind !== "none" ? (
                            <h5 className="border-t pt-3 font-semibold">
                                {selected_connection_kind === "network"
                                    ? "Network connection"
                                    : "Serial connection"}
                            </h5>
                        ) : null}
                        {selected_connection_kind === "network" ? (
                            <div className="grid gap-3 min-[720px]:grid-cols-2">
                                <label className="flex flex-col gap-1" htmlFor="hamlib-host">
                                    <span>Host</span>
                                    <Input
                                        id="hamlib-host"
                                        value={
                                            network_endpoint(
                                                selected_configuration.token_values[
                                                    network_pathname_token
                                                ],
                                            ).host
                                        }
                                        onChange={event =>
                                            update_selected(rig => ({
                                                ...rig,
                                                token_values: {
                                                    ...rig.token_values,
                                                    [network_pathname_token]: network_pathname(
                                                        event.target.value,
                                                        network_endpoint(
                                                            rig.token_values[
                                                                network_pathname_token
                                                            ],
                                                        ).port,
                                                    ),
                                                },
                                            }))
                                        }
                                    />
                                </label>
                                <label className="flex flex-col gap-1" htmlFor="hamlib-port">
                                    <span>Port</span>
                                    <PortInput
                                        id="hamlib-port"
                                        value={radio_port_value}
                                        error={radio_port_error}
                                        show_error_message={false}
                                        onChange={event =>
                                            update_selected(rig => ({
                                                ...rig,
                                                token_values: {
                                                    ...rig.token_values,
                                                    [network_pathname_token]: network_pathname(
                                                        network_endpoint(
                                                            rig.token_values[
                                                                network_pathname_token
                                                            ],
                                                        ).host,
                                                        event.target.value,
                                                    ),
                                                },
                                            }))
                                        }
                                    />
                                </label>
                            </div>
                        ) : selected_connection_kind === "serial" ? (
                            <div className="grid gap-3 min-[720px]:grid-cols-2">
                                {serial_descriptors(
                                    radio_model_details[selected_configuration.model_id] || [],
                                ).map(descriptor => (
                                    <DescriptorInput
                                        key={descriptor.token}
                                        descriptor={descriptor}
                                        error_tokens={selected_errors
                                            .map(error => error.token)
                                            .filter(Boolean)}
                                        colors={colors}
                                        serial_ports={serial_ports}
                                        value={descriptor_value(
                                            descriptor,
                                            selected_configuration.token_values[descriptor.token],
                                            serial_ports,
                                            selected_connection_kind,
                                        )}
                                        on_change={value =>
                                            update_selected(rig => ({
                                                ...rig,
                                                token_values: {
                                                    ...rig.token_values,
                                                    [descriptor.token]: value,
                                                },
                                            }))
                                        }
                                    />
                                ))}
                            </div>
                        ) : null}
                        {radio_model_error ? <p role="alert">{radio_model_error.message}</p> : null}
                    </div>
                    <div className="flex flex-col items-start gap-1">
                        <div className="flex items-center gap-3">
                            <Button
                                type="button"
                                className="whitespace-nowrap px-2 py-1 text-xs"
                                on_click={test_connection}
                            >
                                Test connection
                            </Button>
                            {radio_feedback ? (
                                <p
                                    className={
                                        radio_feedback.ok === true
                                            ? "text-green-600"
                                            : radio_feedback.ok === false
                                              ? "text-red-600"
                                              : "text-gray-500"
                                    }
                                    role={radio_feedback.ok === false ? "alert" : "status"}
                                >
                                    <span aria-hidden="true" className="mr-1 font-bold">
                                        {radio_feedback.ok === true
                                            ? "✓"
                                            : radio_feedback.ok === false
                                              ? "✕"
                                              : "..."}
                                    </span>{" "}
                                    {radio_feedback.message}
                                </p>
                            ) : null}
                        </div>
                        {save_state?.details ? (
                            <details className="w-full text-sm">
                                <summary className="cursor-pointer">Details</summary>
                                <code
                                    className="mt-1 block max-w-[36rem] overflow-x-auto whitespace-pre-wrap rounded p-2 text-left"
                                    style={{
                                        backgroundColor: colors.theme.input_background,
                                        border: `1px solid ${colors.theme.borders}`,
                                        color: colors.theme.text,
                                    }}
                                >
                                    {save_state.details}
                                </code>
                            </details>
                        ) : null}
                    </div>
                </section>
            ) : null}
            {rotator_configuration_capable && rotator_form != null ? (
                <section
                    className="mb-6 flex flex-col gap-4 border-t pt-4"
                    aria-label="Rotator hardware settings"
                >
                    <h4 className="text-lg">Rotator hardware</h4>
                    <label className="flex flex-col gap-1" htmlFor="rotator-backend">
                        <span>Backend</span>
                        <Select
                            id="rotator-backend"
                            value={rotator_form.backend}
                            onChange={event => {
                                set_rotator_save_state(null);
                                set_rotator_form(current => ({
                                    ...current,
                                    backend: event.target.value,
                                }));
                            }}
                        >
                            <option value="unconfigured">Unconfigured</option>
                            <option value="hamlib">Hamlib</option>
                        </Select>
                    </label>
                    {rotator_form.backend === "hamlib" ? (
                        <div className="flex flex-col gap-3">
                            <label className="flex flex-col gap-1" htmlFor="rotator-hamlib-model">
                                <span>Model</span>
                                <SearchSelect
                                    inputId="rotator-hamlib-model"
                                    aria-label="Rotator model"
                                    className="w-full"
                                    filterOption={search_filter}
                                    isOptionDisabled={option => option.isDisabled}
                                    formatOptionLabel={option =>
                                        option.disabled_reason
                                            ? `${option.label} — ${option.disabled_reason}`
                                            : option.label
                                    }
                                    value={selected_rotator_model ?? null}
                                    onChange={option => {
                                        if (!option) return;
                                        set_rotator_save_state(null);
                                        set_rotator_form(current => ({
                                            ...current,
                                            hamlib: {
                                                model_id: option.value,
                                                token_values: {},
                                            },
                                        }));
                                    }}
                                    styles={search_select_styles(colors)}
                                    options={rotator_model_options}
                                />
                            </label>
                            <h5 className="border-t pt-3 font-semibold">
                                {rotator_connection_kind === "network"
                                    ? "Network connection"
                                    : rotator_connection_kind === "serial"
                                      ? "Serial connection"
                                      : "Device configuration"}
                            </h5>
                            {rotator_connection_kind === "network" ? (
                                <div className="grid gap-3 min-[720px]:grid-cols-2">
                                    <label className="flex flex-col gap-1" htmlFor="rotator-host">
                                        <span>Host</span>
                                        <Input
                                            id="rotator-host"
                                            value={
                                                network_endpoint(
                                                    rotator_form.hamlib.token_values.rot_pathname ||
                                                        rotator_network_default,
                                                ).host
                                            }
                                            onChange={event =>
                                                set_rotator_form(current => ({
                                                    ...current,
                                                    hamlib: {
                                                        ...current.hamlib,
                                                        token_values: {
                                                            ...current.hamlib.token_values,
                                                            rot_pathname: network_pathname(
                                                                event.target.value,
                                                                network_endpoint(
                                                                    current.hamlib.token_values
                                                                        .rot_pathname ||
                                                                        rotator_network_default,
                                                                ).port,
                                                            ),
                                                        },
                                                    },
                                                }))
                                            }
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1" htmlFor="rotator-port">
                                        <span>Port</span>
                                        <PortInput
                                            id="rotator-port"
                                            value={rotator_port_value}
                                            error={rotator_port_error}
                                            show_error_message={false}
                                            onChange={event =>
                                                set_rotator_form(current => ({
                                                    ...current,
                                                    hamlib: {
                                                        ...current.hamlib,
                                                        token_values: {
                                                            ...current.hamlib.token_values,
                                                            rot_pathname: network_pathname(
                                                                network_endpoint(
                                                                    current.hamlib.token_values
                                                                        .rot_pathname ||
                                                                        rotator_network_default,
                                                                ).host,
                                                                event.target.value,
                                                            ),
                                                        },
                                                    },
                                                }))
                                            }
                                        />
                                    </label>
                                </div>
                            ) : rotator_connection_kind === "serial" ? (
                                <div className="grid gap-3 min-[720px]:grid-cols-2">
                                    {serial_descriptors(selected_rotator_descriptors).map(
                                        descriptor => (
                                            <DescriptorInput
                                                key={descriptor.token}
                                                descriptor={descriptor}
                                                error_tokens={[]}
                                                colors={colors}
                                                serial_ports={serial_ports}
                                                value={descriptor_value(
                                                    descriptor,
                                                    rotator_form.hamlib.token_values[
                                                        descriptor.token
                                                    ],
                                                    serial_ports,
                                                    selected_rotator_model?.port_type,
                                                )}
                                                on_change={value =>
                                                    set_rotator_form(current => ({
                                                        ...current,
                                                        hamlib: {
                                                            ...current.hamlib,
                                                            token_values: {
                                                                ...current.hamlib.token_values,
                                                                [descriptor.token]: value,
                                                            },
                                                        },
                                                    }))
                                                }
                                            />
                                        ),
                                    )}
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                    <div className="flex items-center gap-3">
                        <Button
                            type="button"
                            className="whitespace-nowrap px-2 py-1 text-xs"
                            on_click={test_rotator}
                        >
                            Test connection
                        </Button>
                        <Button
                            type="button"
                            className="whitespace-nowrap px-2 py-1 text-xs"
                            on_click={save_rotator_configuration}
                        >
                            Apply
                        </Button>
                        {rotator_feedback ? (
                            <p
                                className={
                                    rotator_feedback.ok === true
                                        ? "text-green-600"
                                        : rotator_feedback.ok === false
                                          ? "text-red-600"
                                          : "text-gray-500"
                                }
                                role={rotator_feedback.ok === false ? "alert" : "status"}
                            >
                                {rotator_feedback.message}
                            </p>
                        ) : null}
                    </div>
                </section>
            ) : null}
            <h4 className="mb-2 border-t pt-4 text-lg">Logger integration</h4>
            <table
                className="table-fixed border-separate border-spacing-y-2"
                style={{ color: colors.theme.text }}
            >
                <tbody>
                    <tr>
                        <td>Enable logger integration:&nbsp;&nbsp;</td>
                        <td className="flex gap-2">
                            <Toggle
                                value={temp_settings.highlight_enabled}
                                data_tour="settings-cat-logger-toggle"
                                on_click={() =>
                                    set_temp_settings({
                                        ...temp_settings,
                                        highlight_enabled: !temp_settings.highlight_enabled,
                                    })
                                }
                            />
                            <LoggerIntegrationHelp colors={colors} />
                        </td>
                    </tr>
                    <tr>
                        <td>UDP Port:</td>
                        <td>
                            <PortInput
                                id="logger-port"
                                value={temp_settings.highlight_port}
                                error={logger_port_error}
                                data-tour="settings-cat-udp-port"
                                min={1024}
                                onChange={event =>
                                    set_temp_settings({
                                        ...temp_settings,
                                        highlight_port: Number.parseInt(event.target.value, 10),
                                    })
                                }
                                onBlur={() => set_logger_port_touched(true)}
                            />
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

export default CatControl;

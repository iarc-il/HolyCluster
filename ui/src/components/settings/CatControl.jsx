import Button from "@/components/ui/Button.jsx";
import Input from "@/components/ui/Input.jsx";
import Select from "@/components/ui/Select.jsx";
import Toggle from "@/components/ui/Toggle.jsx";
import { useColors } from "@/hooks/useColors";
import use_radio from "@/hooks/useRadio";
import { useEffect, useState } from "react";
import { default as SearchSelect } from "react-select";
import LoggerIntegrationHelp from "./LoggerIntegrationHelp.jsx";

const serial_labels = {
    rig_pathname: "Serial port",
    pathname: "Serial port",
    device: "Serial port",
    serial_speed: "Baud rate",
    baud: "Baud rate",
    data_bits: "Data bits",
    stop_bits: "Stop bits",
    parity: "Parity",
    serial_handshake: "Handshake",
    rts: "Force Control RTS",
    dtr: "Force Control DTR",
};

const serial_option_values = {
    serial_speed: ["1200", "2400", "4800", "9600", "19200", "38400", "57600", "115200"],
    baud: ["1200", "2400", "4800", "9600", "19200", "38400", "57600", "115200"],
    data_bits: ["5", "6", "7", "8"],
    stop_bits: ["1", "2"],
};

const DEFAULT_HAMLIB_MODEL_ID = "1";
const DEFAULT_UNIX_SERIAL_PORT = "/dev/ttyUSB0";
const DEFAULT_WINDOWS_SERIAL_PORT = "COM1";
const DEFAULT_BAUD_RATE = "9600";
const DEFAULT_RIGCTLD_PORT = "4532";
const DEFAULT_HAMLIB_NETWORK_HOST = "127.0.0.1";
const DEFAULT_HAMLIB_NETWORK_PORT = "4532";

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
    if (["rig_pathname", "pathname", "device"].includes(descriptor.token)) {
        if (port_type === "network" || port_type === "udp_network") {
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
    if (["rig_pathname", "pathname", "device"].includes(descriptor.token)) {
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

function serial_descriptors(descriptors) {
    return descriptors
        .filter(descriptor => Object.hasOwn(serial_labels, descriptor.token))
        .sort(
            (left, right) =>
                Object.keys(serial_labels).indexOf(left.token) -
                Object.keys(serial_labels).indexOf(right.token),
        );
}

function empty_hamlib() {
    return { model_id: DEFAULT_HAMLIB_MODEL_ID, token_values: {} };
}

function empty_rig() {
    return {
        backend: "rigctld",
        hamlib: empty_hamlib(),
        rigctld: { host: "127.0.0.1", port: DEFAULT_RIGCTLD_PORT },
    };
}

function normalize_rig(rig) {
    const fallback = empty_rig();
    const hamlib = { ...fallback.hamlib, ...rig?.hamlib };
    if (!hamlib.model_id) {
        hamlib.model_id = DEFAULT_HAMLIB_MODEL_ID;
    }
    return {
        ...fallback,
        ...rig,
        hamlib,
        rigctld: {
            ...fallback.rigctld,
            ...rig?.rigctld,
            host: rig?.rigctld?.host?.trim() || fallback.rigctld.host,
            port: String(rig?.rigctld?.port || fallback.rigctld.port),
        },
    };
}

function normalize_configuration(configuration) {
    if (configuration == null) {
        return null;
    }

    return {
        rig1: normalize_rig(configuration.rig1),
        rig2: normalize_rig(configuration.rig2),
        rig2_enabled: configuration.rig2 != null,
    };
}

function materialized_hamlib(rig, descriptors, serial_ports, port_type) {
    const token_values = { ...rig.hamlib.token_values };
    for (const descriptor of descriptors.filter(descriptor =>
        Object.hasOwn(serial_labels, descriptor.token),
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

function serialized_rig(rig, descriptors = [], serial_ports = [], port_type = "serial") {
    if (rig.backend === "hamlib") {
        return {
            backend: "hamlib",
            hamlib: materialized_hamlib(rig, descriptors, serial_ports, port_type),
        };
    }
    if (rig.backend === "rigctld") {
        const port = normalize_numeric_value(rig.rigctld.port, {
            kind: "integer",
            minimum: 1,
            maximum: 65535,
            step: 1,
            default: DEFAULT_RIGCTLD_PORT,
        });
        return {
            backend: "rigctld",
            rigctld: { ...rig.rigctld, port: Number.parseInt(port, 10) },
        };
    }
    return { backend: rig.backend };
}

function hamlib_model_options(models) {
    return models.map(model => ({
        value: model.id,
        label: `${model.manufacturer} ${model.model}`,
        port_type: model.port_type,
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

function errors_for_rig(errors, rig) {
    return errors.filter(error => error.field?.startsWith(`${rig}.`));
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
    const label = serial_labels[descriptor.token] || descriptor.label;
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
        radio_configuration,
        radio_configuration_result,
        radio_connection_result,
        hamlib_models,
        hamlib_models_error,
        serial_ports,
        serial_ports_error,
        hamlib_model_details,
        hamlib_model_error,
        get_radio_configuration,
        list_hamlib_models,
        list_serial_ports,
        describe_hamlib_model,
        set_radio_configuration,
        test_radio_connection,
    } = use_radio();
    const [configuration, set_configuration] = useState(null);
    const [selected_rig, set_selected_rig] = useState("rig1");
    const [save_state, set_save_state] = useState(null);
    const [logger_port_touched, set_logger_port_touched] = useState(false);
    const configuration_capable = radio_capabilities?.radio_configuration === true;
    const available_backends = radio_capabilities?.backends || [];
    const selected_configuration = configuration?.[selected_rig];
    const server_errors =
        radio_configuration_result?.failure === "invalid_config"
            ? radio_configuration_result.errors || []
            : [];
    const radio_result = radio_connection_result ?? radio_configuration_result;
    const radio_errors =
        radio_result?.failure === "invalid_config" ? radio_result.errors || [] : [];
    const has_field_errors = radio_result?.failure === "invalid_config" && radio_errors.length > 0;
    const selected_errors = errors_for_rig(radio_errors, selected_rig);
    const model_options = hamlib_model_options(hamlib_models);
    const selected_model = model_options.find(
        option => option.value === selected_configuration?.hamlib?.model_id,
    );
    const selected_port_type = selected_model?.port_type || "serial";
    const logger_port_valid =
        temp_settings.highlight_port >= 1024 && temp_settings.highlight_port <= 65535;

    useEffect(() => {
        if (configuration_capable) {
            get_radio_configuration();
            list_hamlib_models();
            list_serial_ports();
        }
    }, [configuration_capable]);

    useEffect(() => {
        set_configuration(normalize_configuration(radio_configuration));
    }, [radio_configuration]);

    useEffect(() => {
        if (
            selected_configuration?.backend === "hamlib" &&
            selected_configuration.hamlib.model_id
        ) {
            describe_hamlib_model(selected_configuration.hamlib.model_id);
        }
    }, [selected_configuration?.backend, selected_configuration?.hamlib.model_id]);

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
        if (radio_configuration_result?.ok === false && server_errors.length > 0) {
            const first_error = server_errors[0];
            set_selected_rig(first_error.field?.startsWith("rig2.") ? "rig2" : "rig1");
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
        set_configuration(current => ({
            ...current,
            [selected_rig]: update(current[selected_rig]),
        }));
    }

    function serialized_configuration() {
        const serialize = rig =>
            serialized_rig(
                rig,
                rig.backend === "hamlib" ? hamlib_model_details[rig.hamlib.model_id] || [] : [],
                serial_ports,
                rig.backend === "hamlib"
                    ? hamlib_models.find(model => model.id === rig.hamlib.model_id)?.port_type
                    : undefined,
            );
        return {
            rig1: serialize(configuration.rig1),
            ...(configuration.rig2_enabled ? { rig2: serialize(configuration.rig2) } : {}),
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

    if (radio_config_apply_ref != null) {
        radio_config_apply_ref.current = configuration == null ? null : save_configuration;
    }

    return (
        <div className="p-4" data-tour="settings-cat-control">
            {configuration_capable && configuration != null ? (
                <section className="mb-6 flex flex-col gap-4" aria-label="Radio hardware settings">
                    <h4 className="text-lg">Radio hardware</h4>
                    <div className="grid gap-3 min-[720px]:grid-cols-2">
                        <label className="flex flex-col gap-1" htmlFor="radio-rig">
                            <span>Rig</span>
                            <Select
                                id="radio-rig"
                                className="w-full"
                                value={selected_rig}
                                onChange={event => {
                                    set_selected_rig(event.target.value);
                                    set_save_state(null);
                                }}
                            >
                                <option value="rig1">Rig 1</option>
                                <option value="rig2">Rig 2</option>
                            </Select>
                        </label>
                        <label className="flex flex-col gap-1" htmlFor="radio-backend">
                            <span>Backend</span>
                            <Select
                                id="radio-backend"
                                value={selected_configuration.backend}
                                className={
                                    error_matches(radio_errors, `${selected_rig}.backend`)
                                        ? "bg-red-200"
                                        : ""
                                }
                                onChange={event =>
                                    update_selected(rig => ({
                                        ...rig,
                                        backend: event.target.value,
                                    }))
                                }
                            >
                                <option value="unconfigured" disabled>
                                    Choose a backend
                                </option>
                                {available_backends.map(backend => (
                                    <option key={backend} value={backend}>
                                        {backend}
                                    </option>
                                ))}
                            </Select>
                        </label>
                    </div>
                    {selected_rig === "rig2" ? (
                        <label className="flex items-center gap-2" htmlFor="enable-rig2">
                            <input
                                id="enable-rig2"
                                type="checkbox"
                                checked={configuration.rig2_enabled}
                                onChange={event =>
                                    set_configuration(current => ({
                                        ...current,
                                        rig2_enabled: event.target.checked,
                                    }))
                                }
                            />
                            Enable Rig 2
                        </label>
                    ) : null}
                    {selected_configuration.backend === "rigctld" ? (
                        <div className="grid gap-3 min-[720px]:grid-cols-2">
                            <label className="flex flex-col gap-1" htmlFor="rigctld-host">
                                <span>Host</span>
                                <Input
                                    id="rigctld-host"
                                    className={
                                        error_matches(radio_errors, `${selected_rig}.rigctld.host`)
                                            ? "bg-red-200 w-full"
                                            : "w-full"
                                    }
                                    value={selected_configuration.rigctld.host}
                                    onChange={event =>
                                        update_selected(rig => ({
                                            ...rig,
                                            rigctld: {
                                                ...rig.rigctld,
                                                host: event.target.value.replace(/\s/g, ""),
                                            },
                                        }))
                                    }
                                    onBlur={() =>
                                        update_selected(rig => ({
                                            ...rig,
                                            rigctld: {
                                                ...rig.rigctld,
                                                host: rig.rigctld.host || "127.0.0.1",
                                            },
                                        }))
                                    }
                                />
                            </label>
                            <label className="flex flex-col gap-1" htmlFor="rigctld-port">
                                <span>Port</span>
                                <Input
                                    id="rigctld-port"
                                    className={
                                        error_matches(radio_errors, `${selected_rig}.rigctld.port`)
                                            ? "bg-red-200"
                                            : ""
                                    }
                                    type="number"
                                    min="1"
                                    max="65535"
                                    step="1"
                                    value={selected_configuration.rigctld.port}
                                    onChange={event =>
                                        update_selected(rig => ({
                                            ...rig,
                                            rigctld: { ...rig.rigctld, port: event.target.value },
                                        }))
                                    }
                                    onBlur={() =>
                                        update_selected(rig => ({
                                            ...rig,
                                            rigctld: {
                                                ...rig.rigctld,
                                                port: normalize_numeric_value(rig.rigctld.port, {
                                                    kind: "integer",
                                                    minimum: 1,
                                                    maximum: 65535,
                                                    step: 1,
                                                    default: DEFAULT_RIGCTLD_PORT,
                                                }),
                                            },
                                        }))
                                    }
                                />
                            </label>
                        </div>
                    ) : null}
                    {selected_configuration.backend === "hamlib" ? (
                        <div className="flex flex-col gap-3">
                            {hamlib_models_error ? (
                                <p role="alert">{hamlib_models_error.message}</p>
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
                                        const model_id = option.value;
                                        update_selected(rig => ({
                                            ...rig,
                                            hamlib: {
                                                ...rig.hamlib,
                                                model_id,
                                                token_values:
                                                    model_id === rig.hamlib.model_id
                                                        ? rig.hamlib.token_values
                                                        : {},
                                            },
                                        }));
                                    }}
                                    styles={search_select_styles(
                                        colors,
                                        error_matches(
                                            radio_errors,
                                            `${selected_rig}.hamlib.model_id`,
                                        ),
                                    )}
                                    options={model_options}
                                />
                            </label>
                            <h5 className="border-t pt-3 font-semibold">
                                {selected_port_type === "network" ||
                                selected_port_type === "udp_network"
                                    ? "Network connection"
                                    : "Serial connection"}
                            </h5>
                            {selected_port_type === "network" ||
                            selected_port_type === "udp_network" ? (
                                <div className="grid gap-3 min-[720px]:grid-cols-2">
                                    <label className="flex flex-col gap-1" htmlFor="hamlib-host">
                                        <span>Host</span>
                                        <Input
                                            id="hamlib-host"
                                            value={
                                                network_endpoint(
                                                    selected_configuration.hamlib.token_values
                                                        .rig_pathname,
                                                ).host
                                            }
                                            onChange={event =>
                                                update_selected(rig => ({
                                                    ...rig,
                                                    hamlib: {
                                                        ...rig.hamlib,
                                                        token_values: {
                                                            ...rig.hamlib.token_values,
                                                            rig_pathname: network_pathname(
                                                                event.target.value,
                                                                network_endpoint(
                                                                    rig.hamlib.token_values
                                                                        .rig_pathname,
                                                                ).port,
                                                            ),
                                                        },
                                                    },
                                                }))
                                            }
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1" htmlFor="hamlib-port">
                                        <span>Port</span>
                                        <Input
                                            id="hamlib-port"
                                            type="number"
                                            min="1"
                                            max="65535"
                                            step="1"
                                            value={
                                                network_endpoint(
                                                    selected_configuration.hamlib.token_values
                                                        .rig_pathname,
                                                ).port
                                            }
                                            onChange={event =>
                                                update_selected(rig => ({
                                                    ...rig,
                                                    hamlib: {
                                                        ...rig.hamlib,
                                                        token_values: {
                                                            ...rig.hamlib.token_values,
                                                            rig_pathname: network_pathname(
                                                                network_endpoint(
                                                                    rig.hamlib.token_values
                                                                        .rig_pathname,
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
                            ) : selected_port_type === "serial" ? (
                                <div className="grid gap-3 min-[720px]:grid-cols-2">
                                    {serial_descriptors(
                                        hamlib_model_details[
                                            selected_configuration.hamlib.model_id
                                        ] || [],
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
                                                selected_configuration.hamlib.token_values[
                                                    descriptor.token
                                                ],
                                                serial_ports,
                                                selected_model.port_type,
                                            )}
                                            on_change={value =>
                                                update_selected(rig => ({
                                                    ...rig,
                                                    hamlib: {
                                                        ...rig.hamlib,
                                                        token_values: {
                                                            ...rig.hamlib.token_values,
                                                            [descriptor.token]: value,
                                                        },
                                                    },
                                                }))
                                            }
                                        />
                                    ))}
                                </div>
                            ) : null}
                            {hamlib_model_error ? (
                                <p role="alert">{hamlib_model_error.message}</p>
                            ) : null}
                        </div>
                    ) : null}
                    {has_field_errors ? (
                        <ul className="space-y-1 text-red-600" role="alert">
                            {radio_errors.map((error, index) => (
                                <li key={`${error.field}-${error.token || index}`}>
                                    {error_text(error)}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                    <div className="flex flex-col items-start gap-1">
                        <div className="flex items-center gap-3">
                            <Button
                                type="button"
                                className="whitespace-nowrap px-2 py-1 text-xs"
                                on_click={test_connection}
                            >
                                Test connection
                            </Button>
                            {save_state && !has_field_errors ? (
                                <p
                                    className={
                                        save_state.ok === true
                                            ? "text-green-600"
                                            : save_state.ok === false
                                              ? "text-red-600"
                                              : "text-gray-500"
                                    }
                                    role={save_state.ok === false ? "alert" : "status"}
                                >
                                    <span aria-hidden="true" className="mr-1 font-bold">
                                        {save_state.ok === true
                                            ? "✓"
                                            : save_state.ok === false
                                              ? "✕"
                                              : "..."}
                                    </span>{" "}
                                    {save_state.message}
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
                            <Input
                                value={temp_settings.highlight_port}
                                className={
                                    logger_port_touched && !logger_port_valid ? "bg-red-200" : ""
                                }
                                data-tour="settings-cat-udp-port"
                                type="number"
                                min="1024"
                                max="65535"
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

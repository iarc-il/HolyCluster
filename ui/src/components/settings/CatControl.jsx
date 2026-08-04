import Input from "@/components/ui/Input.jsx";
import Select from "@/components/ui/Select.jsx";
import Toggle from "@/components/ui/Toggle.jsx";
import use_radio from "@/hooks/useRadio";
import LoggerIntegrationHelp from "./LoggerIntegrationHelp.jsx";
import { useEffect, useState } from "react";

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

function empty_hamlib() {
    return { model_id: "", token_values: {} };
}

function empty_rig() {
    return {
        backend: "rigctld",
        hamlib: empty_hamlib(),
        rigctld: { host: "127.0.0.1", port: "4532" },
    };
}

function normalize_rig(rig) {
    const fallback = empty_rig();
    return {
        ...fallback,
        ...rig,
        hamlib: { ...fallback.hamlib, ...rig?.hamlib },
        rigctld: {
            ...fallback.rigctld,
            ...rig?.rigctld,
            port: String(rig?.rigctld?.port ?? fallback.rigctld.port),
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

function serialized_rig(rig) {
    if (rig.backend === "hamlib") {
        return { backend: "hamlib", hamlib: rig.hamlib };
    }
    if (rig.backend === "rigctld") {
        return {
            backend: "rigctld",
            rigctld: { ...rig.rigctld, port: Number.parseInt(rig.rigctld.port, 10) },
        };
    }
    return { backend: rig.backend };
}

function error_for_rig(error, rig) {
    return error?.field?.startsWith(`${rig}.`) ? error : null;
}

function DescriptorInput({ descriptor, value, on_change, error_token }) {
    const input_id = `hamlib-${descriptor.token}`;
    const invalid = error_token === descriptor.token;
    const label = serial_labels[descriptor.token] || descriptor.label;
    const input_class = invalid ? "bg-red-200" : "";

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
            {descriptor.kind === "combo" ? (
                <Select
                    id={input_id}
                    aria-invalid={invalid}
                    className={input_class}
                    value={value}
                    onChange={event => on_change(event.target.value)}
                >
                    {descriptor.options.map(option => (
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
                />
            )}
        </label>
    );
}

function CatControl({ temp_settings, set_temp_settings, colors }) {
    const {
        radio_capabilities,
        radio_configuration,
        radio_configuration_result,
        hamlib_models,
        hamlib_models_error,
        hamlib_model_details,
        hamlib_model_error,
        get_radio_configuration,
        list_hamlib_models,
        describe_hamlib_model,
        set_radio_configuration,
    } = use_radio();
    const [configuration, set_configuration] = useState(null);
    const [selected_rig, set_selected_rig] = useState("rig1");
    const [save_state, set_save_state] = useState(null);
    const [logger_port_touched, set_logger_port_touched] = useState(false);
    const [rigctld_port_touched, set_rigctld_port_touched] = useState(false);
    const configuration_capable = radio_capabilities?.radio_configuration === true;
    const available_backends = radio_capabilities?.backends || [];
    const selected_configuration = configuration?.[selected_rig];
    const server_error =
        radio_configuration_result?.ok === false ? radio_configuration_result.error : null;
    const selected_error = error_for_rig(server_error, selected_rig);
    const rigctld_port_valid =
        Number.isInteger(Number(selected_configuration?.rigctld.port)) &&
        Number(selected_configuration?.rigctld.port) >= 1 &&
        Number(selected_configuration?.rigctld.port) <= 65535;
    const rigctld_host_valid = selected_configuration?.rigctld.host.trim().length > 0;
    const logger_port_valid =
        temp_settings.highlight_port >= 1024 && temp_settings.highlight_port <= 65535;

    useEffect(() => {
        if (configuration_capable) {
            get_radio_configuration();
            list_hamlib_models();
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
        } else if (server_error && error_for_rig(server_error, selected_rig)) {
            set_save_state({ ok: false, message: server_error.message });
        }
    }, [radio_configuration_result, selected_rig]);

    function update_selected(update) {
        set_save_state(null);
        set_configuration(current => ({
            ...current,
            [selected_rig]: update(current[selected_rig]),
        }));
    }

    function validate_selected_rig() {
        if (selected_configuration.backend === "hamlib") {
            return selected_configuration.hamlib.model_id.trim().length > 0;
        }
        return (
            selected_configuration.backend !== "rigctld" ||
            (rigctld_host_valid && rigctld_port_valid)
        );
    }

    function save_configuration() {
        set_rigctld_port_touched(true);
        if (!validate_selected_rig()) {
            set_save_state({
                ok: false,
                message: "Fix the highlighted radio settings before saving.",
            });
            return;
        }
        set_save_state({ ok: null, message: "Saving radio hardware..." });
        set_radio_configuration({
            rig1: serialized_rig(configuration.rig1),
            ...(configuration.rig2_enabled ? { rig2: serialized_rig(configuration.rig2) } : {}),
        });
    }

    return (
        <div className="p-4" data-tour="settings-cat-control">
            {configuration_capable && configuration != null ? (
                <section className="mb-6 flex flex-col gap-4" aria-label="Radio hardware settings">
                    <h4 className="text-lg">Radio hardware</h4>
                    <div className="grid gap-3 min-[720px]:grid-cols-2">
                        <label className="flex flex-col gap-1" htmlFor="radio-rig">
                            <span>Rig</span>
                            <select
                                id="radio-rig"
                                className="rounded-lg px-4 py-2"
                                value={selected_rig}
                                onChange={event => {
                                    set_selected_rig(event.target.value);
                                    set_rigctld_port_touched(false);
                                    set_save_state(null);
                                }}
                            >
                                <option value="rig1">Rig 1</option>
                                <option value="rig2">Rig 2</option>
                            </select>
                        </label>
                        <label className="flex flex-col gap-1" htmlFor="radio-backend">
                            <span>Backend</span>
                            <Select
                                id="radio-backend"
                                value={selected_configuration.backend}
                                className={
                                    selected_error?.field === `${selected_rig}.backend`
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
                                        !rigctld_host_valid ||
                                        selected_error?.field === `${selected_rig}.rigctld.host`
                                            ? "bg-red-200 w-full"
                                            : "w-full"
                                    }
                                    value={selected_configuration.rigctld.host}
                                    onChange={event =>
                                        update_selected(rig => ({
                                            ...rig,
                                            rigctld: { ...rig.rigctld, host: event.target.value },
                                        }))
                                    }
                                />
                            </label>
                            <label className="flex flex-col gap-1" htmlFor="rigctld-port">
                                <span>Port</span>
                                <Input
                                    id="rigctld-port"
                                    className={
                                        rigctld_port_touched &&
                                        (!rigctld_port_valid ||
                                            selected_error?.field ===
                                                `${selected_rig}.rigctld.port`)
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
                                    onBlur={() => set_rigctld_port_touched(true)}
                                />
                            </label>
                        </div>
                    ) : null}
                    {selected_configuration.backend === "hamlib" ? (
                        <div className="flex flex-col gap-3">
                            {hamlib_models_error ? (
                                <p role="alert">{hamlib_models_error.message}</p>
                            ) : null}
                            <label className="flex flex-col gap-1" htmlFor="hamlib-model">
                                <span>Model</span>
                                <Input
                                    id="hamlib-model"
                                    list="hamlib-models"
                                    type="search"
                                    className={
                                        selected_error?.field === `${selected_rig}.hamlib.model_id`
                                            ? "bg-red-200 w-full"
                                            : "w-full"
                                    }
                                    value={selected_configuration.hamlib.model_id}
                                    onChange={event =>
                                        update_selected(rig => ({
                                            ...rig,
                                            hamlib: {
                                                ...rig.hamlib,
                                                model_id: event.target.value,
                                                token_values: {},
                                            },
                                        }))
                                    }
                                />
                                <datalist id="hamlib-models">
                                    {hamlib_models.map(model => (
                                        <option key={model.id} value={model.id}>
                                            {model.manufacturer} {model.model}
                                        </option>
                                    ))}
                                </datalist>
                            </label>
                            <h5 className="border-t pt-3 font-semibold">Serial connection</h5>
                            <div className="grid gap-3 min-[720px]:grid-cols-2">
                                {(
                                    hamlib_model_details[selected_configuration.hamlib.model_id] ||
                                    []
                                ).map(descriptor => (
                                    <DescriptorInput
                                        key={descriptor.token}
                                        descriptor={descriptor}
                                        error_token={selected_error?.token}
                                        value={
                                            selected_configuration.hamlib.token_values[
                                                descriptor.token
                                            ] ?? String(descriptor.default)
                                        }
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
                            {hamlib_model_error ? (
                                <p role="alert">{hamlib_model_error.message}</p>
                            ) : null}
                        </div>
                    ) : null}
                    {selected_error ? <p role="alert">{selected_error.message}</p> : null}
                    {save_state &&
                    (!selected_error || save_state.message !== selected_error.message) ? (
                        <p role={save_state.ok === false ? "alert" : "status"}>
                            {save_state.message}
                        </p>
                    ) : null}
                    <button type="button" className="self-start" onClick={save_configuration}>
                        Save radio hardware
                    </button>
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

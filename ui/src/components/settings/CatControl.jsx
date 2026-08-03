import Input from "@/components/ui/Input.jsx";
import Modal from "@/components/ui/Modal.jsx";
import Select from "@/components/ui/Select.jsx";
import Toggle from "@/components/ui/Toggle.jsx";
import use_radio from "@/hooks/useRadio";
import LoggerIntegrationHelp from "./LoggerIntegrationHelp.jsx";
import { useEffect, useState } from "react";

function empty_rig() {
    return { model_id: "", token_values: {} };
}

function normalized_configuration(configuration) {
    if (configuration == null) {
        return null;
    }

    return {
        backend: configuration.backend || "omnirig",
        hamlib:
            configuration.hamlib == null
                ? null
                : {
                      rig1: configuration.hamlib.rig1 || empty_rig(),
                      rig2: configuration.hamlib.rig2 || null,
                  },
    };
}

function update_rig(configuration, rig, update) {
    return {
        ...configuration,
        hamlib: {
            ...configuration.hamlib,
            [rig]: update(configuration.hamlib[rig]),
        },
    };
}

function DescriptorInput({ descriptor, value, on_change, error_token }) {
    const input_id = `hamlib-${descriptor.token}`;
    const invalid = error_token === descriptor.token;
    const input_class = invalid ? "bg-red-200" : "";

    if (descriptor.kind === "boolean") {
        return (
            <label className="flex items-center gap-2" title={descriptor.tooltip} htmlFor={input_id}>
                <input
                    id={input_id}
                    checked={value === "true"}
                    type="checkbox"
                    onChange={event => on_change(String(event.target.checked))}
                />
                {descriptor.label}
            </label>
        );
    }

    return (
        <label className="flex flex-col gap-1" title={descriptor.tooltip} htmlFor={input_id}>
            <span>{descriptor.label}</span>
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
                    type={descriptor.kind === "integer" || descriptor.kind === "numeric" ? "number" : "text"}
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

function RigSettings({ rig, configuration, models, descriptors, error, set_configuration }) {
    const rig_configuration = configuration.hamlib[rig];
    const model_id = rig_configuration.model_id;
    const model_list_id = `${rig}-hamlib-models`;

    return (
        <fieldset className="border rounded p-3 flex flex-col gap-3">
            <legend>{rig === "rig1" ? "Rig 1" : "Rig 2"}</legend>
            <label className="flex flex-col gap-1" htmlFor={`${rig}-model`}>
                <span>Model</span>
                <Input
                    id={`${rig}-model`}
                    list={model_list_id}
                    type="search"
                    className={error?.field === `hamlib.${rig}.model_id` ? "bg-red-200" : ""}
                    value={model_id}
                    onChange={event =>
                        set_configuration(current =>
                            update_rig(current, rig, current_rig => ({
                                ...current_rig,
                                model_id: event.target.value,
                                token_values: {},
                            })),
                        )
                    }
                />
                <datalist id={model_list_id}>
                    {models.map(model => (
                        <option key={model.id} value={model.id}>
                            {model.manufacturer} {model.model}
                        </option>
                    ))}
                </datalist>
            </label>
            {descriptors?.map(descriptor => (
                <DescriptorInput
                    key={descriptor.token}
                    descriptor={descriptor}
                    error_token={error?.token}
                    value={rig_configuration.token_values[descriptor.token] ?? String(descriptor.default)}
                    on_change={value =>
                        set_configuration(current =>
                            update_rig(current, rig, current_rig => ({
                                ...current_rig,
                                token_values: { ...current_rig.token_values, [descriptor.token]: value },
                            })),
                        )
                    }
                />
            ))}
        </fieldset>
    );
}

function CatControl({ temp_settings, set_temp_settings, colors }) {
    const {
        radio_capabilities,
        radio_configuration,
        radio_configuration_result,
        radio_retry_result,
        radio_status,
        hamlib_models,
        hamlib_models_error,
        hamlib_model_detail,
        hamlib_model_details,
        hamlib_model_error,
        get_radio_configuration,
        list_hamlib_models,
        describe_hamlib_model,
        set_radio_configuration,
        retry_radio,
    } = use_radio();
    const [configuration, set_configuration] = useState(null);

    const configuration_capable = radio_capabilities?.radio_configuration === true;
    const configuration_error = radio_configuration_result?.ok === false ? radio_configuration_result.error : null;
    const rig1_model_id = configuration?.hamlib?.rig1?.model_id;
    const rig2_model_id = configuration?.hamlib?.rig2?.model_id;

    useEffect(() => {
        if (configuration_capable) {
            get_radio_configuration();
            list_hamlib_models();
        }
    }, [configuration_capable]);

    useEffect(() => {
        set_configuration(normalized_configuration(radio_configuration));
    }, [radio_configuration]);

    useEffect(() => {
        if (configuration?.backend !== "hamlib") {
            return;
        }

        [rig1_model_id, rig2_model_id].filter(Boolean).forEach(describe_hamlib_model);
    }, [configuration?.backend, rig1_model_id, rig2_model_id]);

    const is_port_valid =
        temp_settings.highlight_port >= 1024 && temp_settings.highlight_port <= 65535;

    function select_backend(backend) {
        set_configuration(current => ({
            backend,
            hamlib:
                backend === "hamlib"
                    ? current?.hamlib || { rig1: empty_rig(), rig2: null }
                    : null,
        }));
    }

    function apply_configuration() {
        if (configuration?.backend === "hamlib" && !configuration.hamlib.rig1.model_id) {
            return;
        }
        set_radio_configuration(configuration);
    }

    return (
        <>
            <div className="p-4" data-tour="settings-cat-control">
                {configuration_capable && configuration != null ? (
                    <section className="mb-6 flex flex-col gap-3" aria-label="Radio hardware settings">
                        <h4 className="text-lg">Radio hardware</h4>
                        <label className="flex flex-col gap-1" htmlFor="radio-backend">
                            <span>Backend</span>
                            <Select
                                id="radio-backend"
                                value={configuration.backend}
                                className={configuration_error?.field === "backend" ? "bg-red-200" : ""}
                                onChange={event => select_backend(event.target.value)}
                            >
                                {radio_capabilities.backends.map(backend => (
                                    <option key={backend} value={backend}>
                                        {backend}
                                    </option>
                                ))}
                            </Select>
                        </label>
                        {configuration.backend === "hamlib" ? (
                            <>
                                {hamlib_models_error != null ? (
                                    <p role="alert">{hamlib_models_error.message}</p>
                                ) : null}
                                <RigSettings
                                    rig="rig1"
                                    configuration={configuration}
                                    models={hamlib_models}
                                    descriptors={hamlib_model_details[rig1_model_id] || hamlib_model_detail}
                                    error={
                                        configuration_error?.field?.startsWith("hamlib.rig1")
                                            ? configuration_error
                                            : null
                                    }
                                    set_configuration={set_configuration}
                                />
                                {hamlib_model_error != null ? (
                                    <p role="alert">{hamlib_model_error.message}</p>
                                ) : null}
                                {configuration.hamlib.rig2 == null ? (
                                    <button
                                        type="button"
                                        className="self-start"
                                        onClick={() =>
                                            set_configuration(current => ({
                                                ...current,
                                                hamlib: { ...current.hamlib, rig2: empty_rig() },
                                            }))
                                        }
                                    >
                                        Add Rig 2
                                    </button>
                                ) : (
                                    <>
                                        <RigSettings
                                            rig="rig2"
                                            configuration={configuration}
                                            models={hamlib_models}
                                            descriptors={hamlib_model_details[rig2_model_id] || hamlib_model_detail}
                                            error={
                                                configuration_error?.field?.startsWith("hamlib.rig2")
                                                    ? configuration_error
                                                    : null
                                            }
                                            set_configuration={set_configuration}
                                        />
                                        <button
                                            type="button"
                                            className="self-start"
                                            onClick={() =>
                                                set_configuration(current => ({
                                                    ...current,
                                                    hamlib: { ...current.hamlib, rig2: null },
                                                }))
                                            }
                                        >
                                            Remove Rig 2
                                        </button>
                                    </>
                                )}
                            </>
                        ) : null}
                        {configuration_error != null ? (
                            <p role="alert">{configuration_error.message}</p>
                        ) : null}
                        {radio_status === "disconnected" ? (
                            <div className="flex items-center gap-2">
                                <span>Radio disconnected</span>
                                <button type="button" onClick={retry_radio}>
                                    Retry
                                </button>
                                {radio_retry_result?.ok === false ? (
                                    <span role="alert">{radio_retry_result.error?.message}</span>
                                ) : null}
                            </div>
                        ) : null}
                        <button
                            type="button"
                            className="self-start"
                            disabled={configuration.backend === "hamlib" && !configuration.hamlib.rig1.model_id}
                            onClick={apply_configuration}
                        >
                            Apply radio hardware
                        </button>
                    </section>
                ) : null}
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
                                    on_click={() => {
                                        set_temp_settings({
                                            ...temp_settings,
                                            highlight_enabled: !temp_settings.highlight_enabled,
                                        });
                                    }}
                                />
                                <LoggerIntegrationHelp colors={colors} />
                            </td>
                        </tr>
                        <tr>
                            <td>UDP Port:</td>
                            <td>
                                <Input
                                    value={temp_settings.highlight_port}
                                    className={is_port_valid ? "" : "bg-red-200"}
                                    data-tour="settings-cat-udp-port"
                                    type="number"
                                    min="1024"
                                    max="65535"
                                    onChange={event => {
                                        set_temp_settings({
                                            ...temp_settings,
                                            highlight_port: Number.parseInt(event.target.value),
                                        });
                                    }}
                                />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </>
    );
}

export default CatControl;

import Button from "@/components/ui/Button.jsx";
import Toggle from "@/components/ui/Toggle.jsx";
import X from "@/components/ui/X.jsx";
import { dxcc_entities } from "@/data/dxcc_entities.js";
import { STATES } from "@/data/states.js";
import { useColors } from "@/hooks/useColors";
import { useProfiles } from "@/hooks/useProfiles.jsx";
import { HUNTER_ADIF_MAX_FILE_SIZE_BYTES, HUNTER_IMPORT_PHASES } from "@/utils/hunter_adif.js";
import { import_hunter_adif_in_worker } from "@/utils/hunter_adif_worker_client.js";
import { HUNTER_SECTION_KEYS } from "@/utils/profile_data.js";
import { useMemo, useState } from "react";

const SECTION_LABELS = {
    dxcc: "DXCC",
    cq_zone: "CQ Zones",
    itu_zone: "ITU Zones",
    us_state: "US States",
    ca_province: "Canada Provinces",
};

const IMPORT_PHASE_LABELS = {
    reading: "Reading ADIF",
    [HUNTER_IMPORT_PHASES.PARSING]: "Parsing ADIF",
    [HUNTER_IMPORT_PHASES.PROCESSING]: "Processing QSOs",
    [HUNTER_IMPORT_PHASES.RESOLVING]: "Resolving callsigns",
    [HUNTER_IMPORT_PHASES.MERGING]: "Saving hunter data",
    [HUNTER_IMPORT_PHASES.COMPLETE]: "Import complete",
};

function range(start, end) {
    const values = [];
    for (let value = start; value <= end; value += 1) {
        values.push(value);
    }
    return values;
}

function create_section_items() {
    return {
        dxcc: dxcc_entities.map(value => ({ value, label: value, search: value.toLowerCase() })),
        cq_zone: range(1, 40).map(value => ({
            value,
            label: `CQ Zone ${value}`,
            search: `cq zone ${value} ${value}`,
        })),
        itu_zone: range(1, 90).map(value => ({
            value,
            label: `ITU Zone ${value}`,
            search: `itu zone ${value} ${value}`,
        })),
        us_state: Object.entries(STATES.USA).map(([value, name]) => ({
            value,
            label: `${value} - ${name}`,
            search: `${value} ${name}`.toLowerCase(),
        })),
        ca_province: Object.entries(STATES.Canada).map(([value, name]) => ({
            value,
            label: `${value} - ${name}`,
            search: `${value} ${name}`.toLowerCase(),
        })),
    };
}

function clamp_percentage(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
}

function get_overall_import_percentage({ phase, percentage }) {
    if (phase === "reading") return clamp_percentage((percentage ?? 0) * 0.1);
    if (phase === HUNTER_IMPORT_PHASES.PARSING) return 15;
    if (phase === HUNTER_IMPORT_PHASES.PROCESSING) return 25;
    if (phase === HUNTER_IMPORT_PHASES.RESOLVING) {
        return clamp_percentage(30 + (percentage ?? 0) * 0.65);
    }
    if (phase === HUNTER_IMPORT_PHASES.MERGING) return 98;
    if (phase === HUNTER_IMPORT_PHASES.COMPLETE) return 100;
    return clamp_percentage(percentage ?? 0);
}

function create_import_progress(update) {
    const progress = {
        phase: update?.phase ?? HUNTER_IMPORT_PHASES.RESOLVING,
        percentage: update?.percentage,
    };
    return {
        phase: progress.phase,
        percentage: get_overall_import_percentage(progress),
    };
}

function read_file_text(file, on_progress) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => {
            on_progress?.(100);
            resolve(event.target.result);
        };
        reader.onprogress = event => {
            if (!event.lengthComputable) return;
            on_progress?.(clamp_percentage((event.loaded / event.total) * 100));
        };
        reader.onerror = () => reject(new Error("Could not read the selected ADIF file."));
        reader.readAsText(file);
    });
}

function format_import_time(imported_at) {
    if (!imported_at) return "Unknown time";
    return new Date(imported_at * 1000).toLocaleString();
}

function sum_added_counts(added_counts) {
    return Object.values(added_counts ?? {}).reduce((sum, count) => sum + Number(count || 0), 0);
}

function HunterSection({
    section,
    items,
    hunter,
    list_mode,
    search,
    colors,
    on_toggle_section,
    on_set_list_mode,
    on_set_search,
    on_set_complete,
    on_clear_completed,
}) {
    const worked_values = hunter.worked[section]?.global ?? [];
    const worked = new Set(worked_values);
    const completed_count = items.filter(item => worked.has(item.value)).length;
    const missing_count = items.length - completed_count;
    const normalized_search = search.trim().toLowerCase();
    const visible_items = items.filter(item => {
        const is_completed = worked.has(item.value);
        if (list_mode === "missing" && is_completed) return false;
        if (list_mode === "completed" && !is_completed) return false;
        return normalized_search.length === 0 || item.search.includes(normalized_search);
    });

    return (
        <section
            className="rounded-lg border p-3 space-y-3"
            style={{ backgroundColor: colors.theme.columns, borderColor: colors.theme.borders }}
        >
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="font-bold leading-tight">{SECTION_LABELS[section]}</h3>
                    <p className="text-xs opacity-75">
                        {completed_count}/{items.length} complete, {missing_count} missing
                    </p>
                </div>
                <Toggle
                    value={hunter.enabled_sections[section]}
                    on_click={() => on_toggle_section(section)}
                />
            </div>

            <div className="h-2 rounded-full overflow-hidden bg-slate-500/30">
                <div
                    className="h-full bg-green-500"
                    style={{
                        width: `${items.length === 0 ? 0 : (completed_count / items.length) * 100}%`,
                    }}
                />
            </div>

            <div className="flex gap-2">
                {[
                    ["missing", "Missing"],
                    ["completed", "Completed"],
                ].map(([mode, label]) => (
                    <button
                        key={mode}
                        type="button"
                        onClick={() => on_set_list_mode(section, mode)}
                        className={`flex-1 rounded-full px-2 py-1 text-xs font-semibold ${
                            list_mode !== mode ? "hover:brightness-110" : ""
                        }`}
                        style={{
                            backgroundColor:
                                list_mode === mode
                                    ? colors.buttons.disabled_background
                                    : colors.buttons.active_tab,
                            color: list_mode === mode ? colors.buttons.disabled : colors.theme.text,
                        }}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div className="flex gap-2">
                <input
                    type="search"
                    value={search}
                    onChange={event => on_set_search(section, event.target.value)}
                    placeholder={`Search ${SECTION_LABELS[section]}`}
                    className="min-w-0 flex-1 rounded px-2 py-1 text-sm"
                    style={{
                        backgroundColor: colors.theme.input_background,
                        color: colors.theme.text,
                        border: `1px solid ${colors.theme.borders}`,
                    }}
                />
                {list_mode === "completed" && (
                    <button
                        type="button"
                        className="shrink-0 rounded px-2 py-1 text-[11px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                            backgroundColor: colors.buttons.active_tab,
                            color: colors.theme.text,
                        }}
                        disabled={worked_values.length === 0}
                        onClick={() => on_clear_completed(section)}
                    >
                        Clear
                    </button>
                )}
            </div>

            <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                {visible_items.length === 0 ? (
                    <p className="text-sm opacity-75">No {list_mode} items match.</p>
                ) : (
                    visible_items.map(item => {
                        const is_completed = worked.has(item.value);
                        return (
                            <div
                                key={`${section}:${item.value}`}
                                className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm"
                                style={{ backgroundColor: colors.theme.background }}
                            >
                                <span>{item.label}</span>
                                {is_completed ? (
                                    <button
                                        type="button"
                                        className="flex items-center justify-center"
                                        onClick={() => on_set_complete(section, item.value, false)}
                                        aria-label={`Mark ${item.label} incomplete`}
                                    >
                                        <X size="20" />
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        className="rounded px-2 py-0.5 text-xs font-semibold"
                                        style={{
                                            backgroundColor: "#16a34a",
                                            color: "white",
                                        }}
                                        onClick={() => on_set_complete(section, item.value, true)}
                                        aria-label={`Mark ${item.label} complete`}
                                    >
                                        Done
                                    </button>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </section>
    );
}

function RecentImports({ imports, colors }) {
    const recent_imports = imports.slice(-5).reverse();

    return (
        <section
            className="rounded-lg border p-3 space-y-2"
            style={{ backgroundColor: colors.theme.columns, borderColor: colors.theme.borders }}
        >
            <h3 className="font-bold">Recent Imports</h3>
            {recent_imports.length === 0 ? (
                <p className="text-sm opacity-75">No ADIF imports yet.</p>
            ) : (
                recent_imports.map((entry, index) => (
                    <div
                        key={`${entry.imported_at}:${entry.file_name}:${index}`}
                        className="rounded p-2 text-xs"
                        style={{ backgroundColor: colors.theme.background }}
                    >
                        <div className="font-semibold truncate">{entry.file_name}</div>
                        <div className="opacity-75">{format_import_time(entry.imported_at)}</div>
                        <div>
                            {entry.qso_count} QSOs, {sum_added_counts(entry.added_counts)} added,{" "}
                            {entry.unresolved_count} unresolved
                        </div>
                    </div>
                ))
            )}
        </section>
    );
}

export default function HunterPanel() {
    const { colors } = useColors();
    const {
        active_profile_data: { hunter },
        update_active_profile_section,
    } = useProfiles();
    const [list_modes, set_list_modes] = useState(
        Object.fromEntries(HUNTER_SECTION_KEYS.map(section => [section, "missing"])),
    );
    const [searches, set_searches] = useState(
        Object.fromEntries(HUNTER_SECTION_KEYS.map(section => [section, ""])),
    );
    const [import_error, set_import_error] = useState("");
    const [is_importing, set_is_importing] = useState(false);
    const [import_progress, set_import_progress] = useState(null);
    const section_items = useMemo(create_section_items, []);

    function update_hunter(updater) {
        update_active_profile_section("hunter", current => updater(current));
    }

    function toggle_section(section) {
        update_hunter(current => ({
            ...current,
            enabled_sections: {
                ...current.enabled_sections,
                [section]: !current.enabled_sections[section],
            },
        }));
    }

    function set_complete(section, value, is_complete) {
        update_hunter(current => {
            const existing = current.worked[section]?.global ?? [];
            const next_values = is_complete
                ? existing.includes(value)
                    ? existing
                    : [...existing, value]
                : existing.filter(existing_value => existing_value !== value);

            return {
                ...current,
                worked: {
                    ...current.worked,
                    [section]: { global: next_values },
                },
            };
        });
    }

    function clear_completed(section) {
        update_hunter(current => ({
            ...current,
            worked: {
                ...current.worked,
                [section]: {
                    ...(current.worked[section] ?? {}),
                    global: [],
                },
            },
        }));
    }

    function set_list_mode(section, mode) {
        set_list_modes(current => ({ ...current, [section]: mode }));
    }

    function set_search(section, search) {
        set_searches(current => ({ ...current, [section]: search }));
    }

    async function handle_import_file(event) {
        const file = event.target.files[0];
        event.target.value = null;
        if (!file) return;

        if (file.size > HUNTER_ADIF_MAX_FILE_SIZE_BYTES) {
            set_import_error("ADIF file is too large. Maximum size is 10 MB.");
            set_import_progress(null);
            return;
        }

        set_is_importing(true);
        set_import_error("");
        set_import_progress(create_import_progress({ phase: "reading", percentage: 0 }));
        try {
            const adif_text = await read_file_text(file, percentage => {
                set_import_progress(create_import_progress({ phase: "reading", percentage }));
            });
            const result = await import_hunter_adif_in_worker({
                hunter,
                adif_text,
                file_name: file.name,
                file_size: file.size,
                on_progress: progress => {
                    set_import_progress(create_import_progress(progress));
                },
            });
            update_active_profile_section("hunter", result.hunter);
        } catch (error) {
            set_import_error(error.message || "Could not import the selected ADIF file.");
        } finally {
            set_is_importing(false);
            set_import_progress(null);
        }
    }

    return (
        <div className="p-3 space-y-3" style={{ color: colors.theme.text }}>
            <section
                className="rounded-lg border p-3 space-y-2"
                style={{ backgroundColor: colors.theme.columns, borderColor: colors.theme.borders }}
            >
                <h2 className="text-lg font-bold">Hunter</h2>
                <div className="flex items-center justify-between gap-2">
                    <label>
                        <input
                            type="file"
                            accept=".adi,.adif"
                            onChange={handle_import_file}
                            className="hidden"
                            disabled={is_importing}
                            data-testid="hunter-adif-input"
                        />
                        <span>
                            <Button
                                type="button"
                                color="blue"
                                disabled={is_importing}
                                on_click={event => {
                                    event.currentTarget
                                        .closest("label")
                                        .querySelector("input")
                                        .click();
                                }}
                            >
                                {is_importing ? "Importing..." : "Import ADIF"}
                            </Button>
                        </span>
                    </label>
                </div>
                {is_importing && import_progress != null ? (
                    <div
                        className="space-y-1"
                        role="progressbar"
                        aria-label="ADIF import progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={import_progress.percentage}
                        tabIndex={0}
                    >
                        <div className="flex justify-between gap-2 text-xs font-semibold">
                            <span>
                                {IMPORT_PHASE_LABELS[import_progress.phase] ?? "Importing ADIF"}
                            </span>
                            <span>{import_progress.percentage}%</span>
                        </div>
                        <div
                            className="h-2 rounded-full overflow-hidden"
                            style={{ backgroundColor: colors.theme.background }}
                        >
                            <div
                                className="h-full bg-green-500 transition-[width] duration-200"
                                style={{ width: `${import_progress.percentage}%` }}
                            />
                        </div>
                    </div>
                ) : null}
                {import_error ? <p className="text-sm text-red-500">{import_error}</p> : null}
            </section>

            {HUNTER_SECTION_KEYS.map(section => (
                <HunterSection
                    key={section}
                    section={section}
                    items={section_items[section]}
                    hunter={hunter}
                    list_mode={list_modes[section]}
                    search={searches[section]}
                    colors={colors}
                    on_toggle_section={toggle_section}
                    on_set_list_mode={set_list_mode}
                    on_set_search={set_search}
                    on_set_complete={set_complete}
                    on_clear_completed={clear_completed}
                />
            ))}

            <RecentImports imports={hunter.imports} colors={colors} />
        </div>
    );
}

import Button from "@/components/ui/Button.jsx";
import Modal from "@/components/ui/Modal.jsx";
import Toggle from "@/components/ui/Toggle.jsx";
import X from "@/components/ui/X.jsx";
import { dxcc_codes, get_dxcc_label } from "@/data/dxcc_entities.js";
import {
    HUNTER_SECTION_KEYS,
    HUNTER_SECTION_LABELS as SECTION_LABELS,
} from "@/data/hunter_sections.js";
import { STATES } from "@/data/states.js";
import { useColors } from "@/hooks/useColors";
import { useProfiles } from "@/hooks/useProfiles.jsx";
import { HUNTER_ADIF_MAX_FILE_SIZE_BYTES, HUNTER_IMPORT_PHASES } from "@/utils/hunter_adif.js";
import { import_hunter_adif_in_worker } from "@/utils/hunter_adif_worker_client.js";
import { useMemo, useState } from "react";

const SECTION_DONE_MESSAGES = {
    dxcc: "No DXCC entities left",
    cq_zone: "No CQ zones left",
    itu_zone: "No ITU zones left",
    us_state: "No US states left",
    ca_province: "No Canadian provinces left",
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
        dxcc: dxcc_codes.map(value => {
            const label = get_dxcc_label(value);
            return { value, label, search: label.toLowerCase() };
        }),
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

function get_section_progress(items, worked_values) {
    const worked = new Set(worked_values);
    const done_count = items.filter(item => worked.has(item.value)).length;
    const needed_count = items.length - done_count;

    return {
        worked,
        done_count,
        needed_count,
        is_section_done: needed_count === 0 && items.length > 0,
    };
}

function get_visible_section_items(items, worked, list_mode, search) {
    const normalized_search = search.trim().toLowerCase();

    return items.filter(item => {
        const is_done = worked.has(item.value);
        if (list_mode === "needed" && is_done) return false;
        if (list_mode === "done" && !is_done) return false;
        return normalized_search.length === 0 || item.search.includes(normalized_search);
    });
}

function TrophyIcon() {
    return (
        <svg
            viewBox="0 0 64 64"
            aria-label="Trophy"
            role="img"
            className="mx-auto h-14 w-14 drop-shadow"
        >
            <path
                d="M18 10h28v8h8c0 11-4.7 18-14 20.5A14.7 14.7 0 0 1 35 42v8h10v6H19v-6h10v-8a14.7 14.7 0 0 1-5-3.5C14.7 36 10 29 10 18h8v-8Z"
                fill="#facc15"
            />
            <path d="M18 18h-4c.5 6.8 2.9 11.2 7.1 13.4A24.3 24.3 0 0 1 18 18Z" fill="#eab308" />
            <path d="M46 18h4c-.5 6.8-2.9 11.2-7.1 13.4A24.3 24.3 0 0 0 46 18Z" fill="#eab308" />
            <path d="M24 16h16v4H24z" fill="#fde68a" opacity=".85" />
            <path d="M25 56h14" stroke="#a16207" strokeWidth="3" strokeLinecap="round" />
        </svg>
    );
}

function SectionDoneState({ section }) {
    return (
        <div className="rounded-lg border border-yellow-400/40 bg-yellow-400/10 px-4 py-5 text-center">
            <TrophyIcon />
            <p className="mt-2 text-sm font-bold">{SECTION_DONE_MESSAGES[section]}</p>
            <p>Well done!</p>
        </div>
    );
}

function HunterSectionCard({ section, items, hunter, colors, on_apply_section }) {
    const worked_values = hunter.worked[section]?.global ?? [];
    const { done_count, needed_count } = get_section_progress(items, worked_values);
    const progress_percentage = items.length === 0 ? 0 : (done_count / items.length) * 100;

    return (
        <section
            className="rounded-lg border p-3 space-y-3"
            style={{ backgroundColor: colors.theme.columns, borderColor: colors.theme.borders }}
        >
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="font-bold leading-tight">{SECTION_LABELS[section]}</h3>
                    <p className="text-xs opacity-75">
                        {done_count}/{items.length} done, {needed_count} needed
                    </p>
                </div>
                <span
                    className="rounded-full px-2 py-1 text-xs font-semibold"
                    style={{ backgroundColor: colors.theme.background }}
                >
                    {hunter.enabled_sections[section] ? "Enabled" : "Disabled"}
                </span>
            </div>

            <div className="h-2 rounded-full overflow-hidden bg-slate-500/30">
                <div className="h-full bg-green-500" style={{ width: `${progress_percentage}%` }} />
            </div>

            <HunterSectionModal
                section={section}
                items={items}
                hunter={hunter}
                colors={colors}
                on_apply_section={on_apply_section}
            />
        </section>
    );
}

function HunterSectionModal({ section, items, hunter, colors, on_apply_section }) {
    const [draft_enabled, set_draft_enabled] = useState(hunter.enabled_sections[section]);
    const [draft_worked_values, set_draft_worked_values] = useState(
        hunter.worked[section]?.global ?? [],
    );
    const [list_mode, set_list_mode] = useState("needed");
    const [search, set_search] = useState("");
    const draft_hunter = {
        ...hunter,
        enabled_sections: {
            ...hunter.enabled_sections,
            [section]: draft_enabled,
        },
        worked: {
            ...hunter.worked,
            [section]: {
                ...(hunter.worked[section] ?? {}),
                global: draft_worked_values,
            },
        },
    };

    function reset_draft() {
        set_draft_enabled(hunter.enabled_sections[section]);
        set_draft_worked_values([...(hunter.worked[section]?.global ?? [])]);
        set_list_mode("needed");
        set_search("");
    }

    function set_done(_section, value, is_done) {
        set_draft_worked_values(current => {
            if (is_done) {
                return current.includes(value) ? current : [...current, value];
            }

            return current.filter(existing_value => existing_value !== value);
        });
    }

    return (
        <Modal
            title={<h2 className="font-bold">{SECTION_LABELS[section]}</h2>}
            button={
                <Button type="button" color="blue" className="px-3 py-1">
                    Edit
                </Button>
            }
            on_open={reset_draft}
            on_cancel={reset_draft}
            on_apply={() => {
                on_apply_section(section, draft_enabled, draft_worked_values);
                return true;
            }}
            modal_style={{ width: "min(42rem, calc(100vw - 2rem))" }}
        >
            <div className="p-3">
                <HunterSection
                    section={section}
                    items={items}
                    hunter={draft_hunter}
                    list_mode={list_mode}
                    search={search}
                    colors={colors}
                    on_toggle_section={() => set_draft_enabled(current => !current)}
                    on_set_list_mode={(_section, mode) => set_list_mode(mode)}
                    on_set_search={(_section, next_search) => set_search(next_search)}
                    on_set_done={set_done}
                    on_clear_done={() => set_draft_worked_values([])}
                />
            </div>
        </Modal>
    );
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
    on_set_done,
    on_clear_done,
}) {
    const worked_values = hunter.worked[section]?.global ?? [];
    const { worked, done_count, needed_count, is_section_done } = get_section_progress(
        items,
        worked_values,
    );
    const visible_items = get_visible_section_items(items, worked, list_mode, search);

    return (
        <section
            className="rounded-lg border p-3 space-y-3"
            style={{ backgroundColor: colors.theme.columns, borderColor: colors.theme.borders }}
        >
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="font-bold leading-tight">{SECTION_LABELS[section]}</h3>
                    <p className="text-xs opacity-75">
                        {done_count}/{items.length} done, {needed_count} needed
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
                        width: `${items.length === 0 ? 0 : (done_count / items.length) * 100}%`,
                    }}
                />
            </div>

            <div className="flex gap-2">
                {[
                    ["needed", "Needed"],
                    ["done", "Done"],
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
                {list_mode === "done" && (
                    <ClearDoneButton
                        section={section}
                        done_count={done_count}
                        colors={colors}
                        on_clear_done={on_clear_done}
                    />
                )}
            </div>

            <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                {visible_items.length === 0 ? (
                    is_section_done && list_mode === "needed" ? (
                        <SectionDoneState section={section} />
                    ) : (
                        <p className="text-sm opacity-75">No {list_mode} items match.</p>
                    )
                ) : (
                    visible_items.map(item => {
                        const is_done = worked.has(item.value);
                        return (
                            <div
                                key={`${section}:${item.value}`}
                                className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm"
                                style={{ backgroundColor: colors.theme.background }}
                            >
                                <span>{item.label}</span>
                                {is_done ? (
                                    <button
                                        type="button"
                                        className="flex items-center justify-center"
                                        onClick={() => on_set_done(section, item.value, false)}
                                        aria-label={`Mark ${item.label} needed`}
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
                                        onClick={() => on_set_done(section, item.value, true)}
                                        aria-label={`Mark ${item.label} done`}
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

function ClearDoneButton({ section, done_count, colors, on_clear_done }) {
    const [is_confirming, set_is_confirming] = useState(false);

    if (done_count === 0) {
        return (
            <button
                type="button"
                className="shrink-0 rounded px-2 py-1 text-[11px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                    backgroundColor: colors.buttons.active_tab,
                    color: colors.theme.text,
                }}
                disabled={true}
            >
                Clear
            </button>
        );
    }

    if (is_confirming) {
        return (
            <div className="shrink-0 flex items-center gap-1 text-[11px]">
                <span className="font-semibold">
                    Clear {done_count} done {SECTION_LABELS[section]} item
                    {done_count === 1 ? "" : "s"}?
                </span>
                <button
                    type="button"
                    className="rounded px-2 py-1 font-semibold"
                    style={{
                        backgroundColor: colors.buttons.active_tab,
                        color: colors.theme.text,
                    }}
                    onClick={() => set_is_confirming(false)}
                >
                    Keep
                </button>
                <button
                    type="button"
                    className="rounded px-2 py-1 font-semibold text-white bg-red-600 hover:bg-red-700"
                    onClick={() => {
                        on_clear_done(section);
                        set_is_confirming(false);
                    }}
                >
                    Clear
                </button>
            </div>
        );
    }

    return (
        <button
            type="button"
            className="shrink-0 rounded px-2 py-1 text-[11px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
                backgroundColor: colors.buttons.active_tab,
                color: colors.theme.text,
            }}
            onClick={() => set_is_confirming(true)}
        >
            Clear
        </button>
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
    const [import_error, set_import_error] = useState("");
    const [is_importing, set_is_importing] = useState(false);
    const [import_progress, set_import_progress] = useState(null);
    const section_items = useMemo(create_section_items, []);

    function update_hunter(updater) {
        update_active_profile_section("hunter", current => updater(current));
    }

    function apply_section(section, enabled, worked_values) {
        update_hunter(current => ({
            ...current,
            enabled_sections: {
                ...current.enabled_sections,
                [section]: enabled,
            },
            worked: {
                ...current.worked,
                [section]: {
                    ...(current.worked[section] ?? {}),
                    global: worked_values,
                },
            },
        }));
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
                <HunterSectionCard
                    key={section}
                    section={section}
                    items={section_items[section]}
                    hunter={hunter}
                    colors={colors}
                    on_apply_section={apply_section}
                />
            ))}

            <RecentImports imports={hunter.imports} colors={colors} />
        </div>
    );
}

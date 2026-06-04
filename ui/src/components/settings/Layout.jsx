const view_options = [
    {
        value: "both",
        title: "Map + Table",
        panels: ["map", "table"],
    },
    {
        value: "map",
        title: "Map only",
        panels: ["map"],
    },
    {
        value: "table",
        title: "Table only",
        panels: ["table"],
    },
];

const order_options = [
    {
        value: "map_table",
        title: "Map left",
        panels: ["map", "table"],
    },
    {
        value: "table_map",
        title: "Table left",
        panels: ["table", "map"],
    },
];

function MiniMap({ colors }) {
    return (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <circle cx="14" cy="14" r="11" stroke={colors.theme.text} strokeWidth="1.8" />
            <path d="M3 14h22" stroke={colors.theme.text} strokeWidth="1.2" opacity="0.55" />
            <path
                d="M14 3c3 3.4 4.5 7 4.5 11S17 21.6 14 25"
                stroke={colors.theme.text}
                strokeWidth="1.2"
                opacity="0.55"
            />
            <path
                d="M14 3c-3 3.4-4.5 7-4.5 11S11 21.6 14 25"
                stroke={colors.theme.text}
                strokeWidth="1.2"
                opacity="0.55"
            />
        </svg>
    );
}

function MiniTable({ colors }) {
    return (
        <div className="grid w-8 grid-cols-3 gap-0.5" aria-hidden="true">
            {Array.from({ length: 9 }).map((_, index) => (
                <div
                    key={index}
                    className="h-2 rounded-sm"
                    style={{ backgroundColor: colors.theme.text, opacity: index < 3 ? 0.85 : 0.5 }}
                />
            ))}
        </div>
    );
}

function PreviewPanel({ panel, colors }) {
    const is_map = panel === "map";

    return (
        <div
            className="flex min-w-0 flex-col items-center justify-center gap-1 rounded-md border px-2"
            style={{
                flex: is_map ? "1 1 57%" : "1 1 43%",
                borderColor: colors.theme.borders,
                backgroundColor: colors.theme.background,
            }}
        >
            {is_map ? <MiniMap colors={colors} /> : <MiniTable colors={colors} />}
            <span className="text-xs font-semibold">{is_map ? "Map" : "Table"}</span>
        </div>
    );
}

function OptionCard({ option, selected, disabled = false, colors, on_select }) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={on_select}
            className={`rounded-xl border-2 p-3 text-left transition ${
                disabled ? "cursor-not-allowed opacity-50" : "hover:-translate-y-0.5"
            }`}
            style={{
                color: colors.theme.text,
                borderColor: selected ? colors.theme.highlighted_tab : colors.theme.borders,
                backgroundColor: colors.theme.background,
                boxShadow: selected ? `0 0 0 2px ${colors.theme.highlighted_tab}` : "none",
            }}
        >
            <div
                className="mb-3 flex h-24 gap-2 rounded-lg border p-2"
                style={{ borderColor: colors.theme.borders }}
            >
                {option.panels.map(panel => (
                    <PreviewPanel key={panel} panel={panel} colors={colors} />
                ))}
            </div>
            <div className="font-semibold">{option.title}</div>
        </button>
    );
}

function Layout({ temp_settings, set_temp_settings, colors }) {
    const main_view_mode = temp_settings.main_view_mode ?? "both";
    const main_view_order = temp_settings.main_view_order ?? "map_table";
    const can_choose_order = main_view_mode === "both";

    function update_setting(key, value) {
        set_temp_settings(state => ({
            ...state,
            [key]: value,
        }));
    }

    return (
        <div className="space-y-6 p-4" style={{ color: colors.theme.text }}>
            <section>
                <div className="mb-3">
                    <h4 className="text-lg font-semibold">Workspace</h4>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                    {view_options.map(option => (
                        <OptionCard
                            key={option.value}
                            option={option}
                            selected={main_view_mode === option.value}
                            colors={colors}
                            on_select={() => update_setting("main_view_mode", option.value)}
                        />
                    ))}
                </div>
            </section>

            <section>
                <div className="mb-3">
                    <h4 className="text-lg font-semibold">Panel Order</h4>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                    {order_options.map(option => (
                        <OptionCard
                            key={option.value}
                            option={option}
                            selected={main_view_order === option.value}
                            disabled={!can_choose_order}
                            colors={colors}
                            on_select={() => update_setting("main_view_order", option.value)}
                        />
                    ))}
                </div>
                {!can_choose_order ? (
                    <p className="mt-3 text-sm opacity-75">
                        Order applies when Map + Table is selected.
                    </p>
                ) : null}
            </section>
        </div>
    );
}

export default Layout;

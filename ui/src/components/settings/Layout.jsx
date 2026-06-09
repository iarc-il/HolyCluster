const layout_options = [
    {
        value: "map",
        title: "Map only",
        panels: ["map"],
        main_view_mode: "map",
    },
    {
        value: "table",
        title: "Table only",
        panels: ["table"],
        main_view_mode: "table",
    },
    {
        value: "map_table",
        title: "Map + Table",
        panels: ["map", "table"],
        main_view_mode: "both",
        main_view_order: "map_table",
    },
    {
        value: "table_map",
        title: "Table + Map",
        panels: ["table", "map"],
        main_view_mode: "both",
        main_view_order: "table_map",
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

function PreviewPanel({ panel, colors, border }) {
    const is_map = panel === "map";
    const border_class = border ? "border" : "";

    return (
        <div
            className={
                "flex grow basis-1/2 flex-col items-center justify-center gap-2 rounded-md px-2 " +
                border_class
            }
            style={{
                borderColor: colors.theme.borders,
                backgroundColor: colors.theme.background,
            }}
        >
            {is_map ? <MiniMap colors={colors} /> : <MiniTable colors={colors} />}
            <span className="text-xs font-semibold">{is_map ? "Map" : "Table"}</span>
        </div>
    );
}

function OptionCard({ option, selected, colors, on_select }) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            onClick={on_select}
            className="rounded-xl border-2 p-3 text-left transition hover:-translate-y-0.5"
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
                    <PreviewPanel
                        key={panel}
                        panel={panel}
                        colors={colors}
                        border={option.panels.length > 1}
                    />
                ))}
            </div>
            <div className="font-semibold">{option.title}</div>
        </button>
    );
}

function Layout({ temp_settings, set_temp_settings, colors }) {
    const main_view_mode = temp_settings.main_view_mode ?? "both";
    const main_view_order = temp_settings.main_view_order ?? "map_table";
    const selected_layout =
        main_view_mode === "map"
            ? "map"
            : main_view_mode === "table"
              ? "table"
              : main_view_order === "table_map"
                ? "table_map"
                : "map_table";

    function select_layout(option) {
        set_temp_settings(state => ({
            ...state,
            main_view_mode: option.main_view_mode,
            main_view_order: option.main_view_order ?? state.main_view_order ?? "map_table",
        }));
    }

    return (
        <div className="space-y-6 p-4" style={{ color: colors.theme.text }}>
            <section>
                <div className="grid gap-3 md:grid-cols-4">
                    {layout_options.map(option => (
                        <OptionCard
                            key={option.value}
                            option={option}
                            selected={selected_layout === option.value}
                            colors={colors}
                            on_select={() => select_layout(option)}
                        />
                    ))}
                </div>
            </section>
        </div>
    );
}

export default Layout;

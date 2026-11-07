import { useColors } from "@/hooks/useColors";

export default function MobileWorkspaceNavigation({
    panel_keys,
    active_panel,
    on_select,
    map_icon,
    table_icon,
}) {
    const { colors } = useColors();
    return (
        <nav
            aria-label="Workspace"
            data-tour="mobile-main-tabs"
            className="flex shrink-0 border-t z-[60]"
            style={{ backgroundColor: colors.theme.background, borderColor: colors.theme.borders }}
        >
            {[...panel_keys, "filters", "explore"].map(panel => {
                const utility = panel === "filters" || panel === "explore";
                const label = {
                    map: "Map",
                    table: "Spots",
                    filters: "Filters",
                    explore: "Tools",
                }[panel];
                const active = active_panel === panel;
                return (
                    <div key={panel} className="flex flex-1 min-w-0">
                        <button
                            type="button"
                            className="flex flex-col gap-1 items-center justify-center w-full min-h-14 border-t-2 pb-[env(safe-area-inset-bottom)] text-xs font-semibold focus-visible:outline focus-visible:outline-2"
                            data-tour={`mobile-main-tab-${panel}`}
                            data-tour-state={active ? "active" : "inactive"}
                            aria-label={label}
                            aria-pressed={active}
                            aria-controls={`mobile-workspace-${panel}`}
                            style={{
                                color: colors.theme.text,
                                borderColor: active ? colors.theme.text : "transparent",
                                backgroundColor: active
                                    ? colors.theme.input_background
                                    : "transparent",
                            }}
                            onClick={() => on_select(panel)}
                        >
                            <svg
                                width="20"
                                height="20"
                                viewBox={utility ? "0 0 24 24" : "0 0 16 16"}
                                fill={utility ? "none" : "currentColor"}
                                stroke={utility ? "currentColor" : undefined}
                                strokeWidth="2"
                                aria-hidden="true"
                            >
                                {utility ? (
                                    panel === "filters" ? (
                                        <path d="M3 4h18l-7 8v7l-4 2v-9z" />
                                    ) : (
                                        <>
                                            <path d="M4 7h16M4 17h16" />
                                            <rect x="7" y="4" width="4" height="6" rx="1" />
                                            <rect x="14" y="14" width="4" height="6" rx="1" />
                                        </>
                                    )
                                ) : (
                                    <path d={panel === "map" ? map_icon : table_icon} />
                                )}
                            </svg>
                            <span>{label}</span>
                        </button>
                    </div>
                );
            })}
        </nav>
    );
}

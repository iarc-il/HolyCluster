import { useColors } from "@/hooks/useColors";

export default function MobileWorkspaceNavigation({
    panel_keys,
    active_panel,
    on_select,
    open_panel,
    toggle_panel,
    map_icon,
    table_icon,
}) {
    const { colors } = useColors();
    return (
        <nav
            aria-label="Workspace"
            data-tour="mobile-main-tabs"
            className="flex shrink-0 border-t pb-[env(safe-area-inset-bottom)] z-[60]"
            style={{ backgroundColor: colors.theme.background, borderColor: colors.theme.borders }}
        >
            {[...panel_keys, "filters", "tools"].map(panel => {
                const drawer = panel === "filters" || panel === "tools";
                const label = panel[0].toUpperCase() + panel.slice(1);
                const active = open_panel ? open_panel === panel : active_panel === panel;
                return (
                    <div
                        key={panel}
                        className="flex flex-1 min-w-0"
                        data-tour={
                            drawer
                                ? `top-bar-${panel === "filters" ? "left" : "right"}-menu`
                                : undefined
                        }
                    >
                        <button
                            type="button"
                            className="flex flex-col gap-1 items-center justify-center w-full min-h-14 border-t-2 text-xs font-semibold focus-visible:outline focus-visible:outline-2"
                            data-tour={drawer ? undefined : `mobile-main-tab-${panel}`}
                            data-tour-state={active ? "active" : "inactive"}
                            aria-label={
                                drawer
                                    ? `${open_panel === panel ? "Close" : "Open"} ${label}`
                                    : label
                            }
                            aria-pressed={drawer ? undefined : active_panel === panel}
                            aria-expanded={drawer ? open_panel === panel : undefined}
                            aria-controls={drawer ? `${panel}-panel` : undefined}
                            style={{
                                color: colors.theme.text,
                                borderColor: active ? colors.theme.text : "transparent",
                                backgroundColor: active
                                    ? colors.theme.input_background
                                    : "transparent",
                            }}
                            onClick={event =>
                                drawer ? toggle_panel(panel, event.currentTarget) : on_select(panel)
                            }
                        >
                            <svg
                                width="20"
                                height="20"
                                viewBox={drawer ? "0 0 24 24" : "0 0 16 16"}
                                fill={drawer ? "none" : "currentColor"}
                                stroke={drawer ? "currentColor" : undefined}
                                strokeWidth="2"
                                aria-hidden="true"
                            >
                                {drawer ? (
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

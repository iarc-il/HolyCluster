import DXpeditions from "@/components/DXpeditions.jsx";
import FilterButton from "@/components/FilterButton.jsx";
import FilterOptions from "@/components/FilterOptions.jsx";
import Filters from "@/components/Filters.jsx";
import FrequencyBar from "@/components/FrequencyBar.jsx";
import Heatmap from "@/components/Heatmap.jsx";
import MissingPanel from "@/components/MissingPanel.jsx";
import UtilityButtons from "@/components/UtilityButtons";
import WebsiteTour from "@/components/tour/WebsiteTour.jsx";
import { TOUR_SELECT_SIDE_PANEL_TAB_EVENT } from "@/components/tour/tour_events.js";
import { continents } from "@/data/filters_data.js";
import { useColors } from "@/hooks/useColors";
import { useFilters } from "@/hooks/useFilters";
import { useLocalStorage } from "@uidotdev/usehooks";

import { useEffect } from "react";

const continent_title = { dx: "DX", spotter: "DE" };

export function ContinentColumn({ spot_type, colors, mobile = false }) {
    const { filters, setFilters } = useFilters();
    const filter_key = `${spot_type}_continents`;
    const color = colors.buttons[`${spot_type}_continents`];

    return (
        <div
            className={`flex ${mobile ? "flex-wrap p-3" : "flex-col p-1"} gap-3 items-center`}
            data-tour={`${spot_type}-continent-filters`}
        >
            <strong className={mobile ? "w-full" : ""} style={{ color: colors.theme.text }}>
                {continent_title[spot_type]}
            </strong>
            {continents.map(continent => (
                <FilterOptions
                    touch={mobile}
                    key={`${spot_type}_${continent}`}
                    filter_key={filter_key}
                    filter_value={continent}
                    orientation="left"
                >
                    <FilterButton
                        className={mobile ? "min-h-11 min-w-16" : ""}
                        color={color}
                        text={continent}
                        text_color={colors.theme.text}
                        is_active={filters[filter_key][continent]}
                        data_tour={`${spot_type}-continent-filter-${continent}`}
                        on_click={_ => {
                            setFilters(state => ({
                                ...state,
                                [filter_key]: {
                                    ...state[filter_key],
                                    [continent]: !state[filter_key][continent],
                                },
                            }));
                        }}
                    />
                </FilterOptions>
            ))}
        </div>
    );
}

export function SwapButton({ colors }) {
    const { filters, setFilters } = useFilters();

    const areFiltersEqual = continents.every(
        continent => filters.dx_continents[continent] === filters.spotter_continents[continent],
    );

    const swapContinents = () => {
        if (areFiltersEqual) return;
        setFilters(state => ({
            ...state,
            dx_continents: { ...state.spotter_continents },
            spotter_continents: { ...state.dx_continents },
        }));
    };

    return (
        <button
            type="button"
            onClick={swapContinents}
            className={`w-16 rounded-full select-none border border-slate-700 flex justify-center py-0.5 ${
                areFiltersEqual
                    ? "opacity-50 pointer-events-none"
                    : "cursor-pointer hover:brightness-110"
            }`}
            style={{ backgroundColor: colors.buttons.disabled_background }}
            aria-label="Swap DX and DE continent filters"
            title="Swap DX and DE continent filters"
            disabled={areFiltersEqual}
            data-tour="swap-continent-filters"
        >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <title>Swap continents</title>
                <path
                    d="M7 4L7 20M7 4L3 8M7 4L11 8"
                    stroke="#000000"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                <path
                    d="M17 20L17 4M17 20L21 16M17 20L13 16"
                    stroke="#000000"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        </button>
    );
}

function Separator() {
    return <div className="border-t-2 border-slate-300 w-full" />;
}

function RightColumnContent({ colors }) {
    return (
        <div
            className="flex flex-col gap-2 w-16 h-full overflow-y-auto shrink-0"
            data-tour="continent-filter-column"
            style={{
                backgroundColor: colors.theme.columns,
                borderLeft: `1px solid ${colors.theme.borders}`,
            }}
        >
            <ContinentColumn spot_type="dx" colors={colors} />
            <Separator />
            <div className="flex justify-center">
                <SwapButton colors={colors} />
            </div>
            <Separator />
            <ContinentColumn spot_type="spotter" colors={colors} />
            <Separator />
            <div className="flex flex-col items-center mt-auto mb-2 space-y-3">
                <UtilityButtons />
            </div>
        </div>
    );
}

const view_options = [
    {
        label: "Filters",
        bg: "#93c5fd",
        icon: "M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5zm1 .5v1.308l4.372 4.858A.5.5 0 0 1 7 8.5v5.306l2-.666V8.5a.5.5 0 0 1 .128-.334L13.5 3.308V2z",
        viewbox: "0 0 16 16",
        size: 32,
        is_disabled: false,
    },
    {
        label: "Band Bar",
        bg: "#a855f7",
        icon: "M3.05 3.05a7 7 0 0 0 0 9.9.5.5 0 0 1-.707.707 8 8 0 0 1 0-11.314.5.5 0 0 1 .707.707m2.122 2.122a4 4 0 0 0 0 5.656.5.5 0 1 1-.708.708 5 5 0 0 1 0-7.072.5.5 0 0 1 .708.708m5.656-.708a.5.5 0 0 1 .708 0 5 5 0 0 1 0 7.072.5.5 0 1 1-.708-.708 4 4 0 0 0 0-5.656.5.5 0 0 1 0-.708m2.122-2.12a.5.5 0 0 1 .707 0 8 8 0 0 1 0 11.313.5.5 0 0 1-.707-.707 7 7 0 0 0 0-9.9.5.5 0 0 1 0-.707zM6 8a2 2 0 1 1 2.5 1.937V15.5a.5.5 0 0 1-1 0V9.937A2 2 0 0 1 6 8",
        viewbox: "0 0 16 16",
        size: 32,
        is_disabled: false,
    },
    {
        label: "Heatmap",
        bg: "#f72e2e",
        icon: "M14.4527 8.48679L12.1842 3.93896L11.4471 4.74309C7.30945 9.25693 6 11.9609 6 14.2499C6 17.422 8.73452 19.909 12 19.909C15.2655 19.909 18 17.422 18 14.2499C18 13.3179 17.6746 12.3124 17.2381 11.3658C16.796 10.4069 16.2091 9.44335 15.62 8.57788L15.1065 7.82342L14.4527 8.48679ZM14.0473 11.0348L14.8818 10.1883C15.256 10.7846 15.6008 11.397 15.876 11.9938C16.2765 12.8625 16.5 13.6357 16.5 14.2499C16.5 15.0941 16.2233 15.8901 15.7438 16.5554C15.7479 16.4935 15.75 16.4309 15.75 16.3675C15.75 15.8056 15.5231 15.2413 15.2632 14.7624C14.9946 14.2679 14.6434 13.7798 14.2995 13.3507L13.8135 12.7443L13.4772 13.034L12.1744 10.8159L11.4903 11.4497C9.13721 13.6298 8.25 15.0508 8.25 16.3675C8.25 16.4309 8.25209 16.4935 8.25622 16.5554C7.77669 15.8901 7.5 15.0941 7.5 14.2499C7.5 12.6786 8.327 10.5308 11.8206 6.5705L14.0473 11.0348ZM13.0943 15.344L13.5948 14.9127C13.7259 15.1036 13.8447 15.2936 13.9449 15.4781C14.1632 15.8802 14.25 16.1791 14.25 16.3675C14.25 17.1171 13.4131 17.9999 12 17.9999C10.5869 17.9999 9.75 17.1171 9.75 16.3675C9.75 15.8235 10.0697 14.9464 11.8334 13.1972L13.0943 15.344Z",
        viewbox: "0 0 24 24",
        size: 44,
        is_disabled: false,
    },
    {
        label: "DXpeditions",
        bg: "#FFD700",
        icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z",
        viewbox: "0 0 24 24",
        size: 32,
        is_disabled: false,
    },
    {
        label: "Missing",
        bg: "#22c55e",
        icon: "M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z",
        viewbox: "0 0 24 24",
        size: 32,
        is_disabled: false,
    },
    {
        label: "Tours",
        bg: "#3b82f6",
        icon: "M1 2.828c.885-.37 2.154-.769 3.5-.769 1.258 0 2.294.31 3.5 1.436V14.5c-1.206-1.126-2.242-1.436-3.5-1.436-1.346 0-2.615.4-3.5.769zm14 0c-.885-.37-2.154-.769-3.5-.769-1.258 0-2.294.31-3.5 1.436V14.5c1.206-1.126 2.242-1.436 3.5-1.436 1.346 0 2.615.4 3.5.769z",
        viewbox: "0 0 16 16",
        size: 32,
        is_disabled: false,
        mobile_only: true,
    },
];

function ViewSelectorTabs({ active_view, set_active_view, colors, mobile = false }) {
    return (
        <div
            className="flex shrink-0 border-b-2"
            data-tour="side-panel-tabs"
            style={{
                borderColor: colors.table.header_arrow,
                color: mobile ? colors.theme.text : undefined,
            }}
        >
            {view_options.map((option, index) => {
                if ((mobile && index === 0) || (!mobile && option.mobile_only)) return null;
                const is_active = active_view === index;
                return (
                    <div
                        key={option.label}
                        onClick={() => {
                            if (!is_active && !option.is_disabled) {
                                set_active_view(index);
                            }
                        }}
                        onKeyDown={event => {
                            if (
                                !is_active &&
                                !option.is_disabled &&
                                (event.key === "Enter" || event.key === " ")
                            ) {
                                event.preventDefault();
                                set_active_view(index);
                            }
                        }}
                        className={`flex items-center justify-center flex-1 ${mobile ? "min-h-14 flex-col gap-0.5" : ""} py-0.5 transition-colors rounded-md${
                            !is_active && !option.is_disabled
                                ? " cursor-pointer opacity-60 hover:opacity-100"
                                : ""
                        }`}
                        style={{
                            backgroundColor: is_active ? colors.buttons.active_tab : undefined,
                        }}
                        aria-label={mobile && index === 1 ? "Band activity" : option.label}
                        title={option.label}
                        role="button"
                        tabIndex={0}
                        data-tour={`side-panel-tab-${option.label.toLowerCase().replaceAll(" ", "-")}`}
                        data-tour-state={is_active ? "active" : "inactive"}
                        aria-pressed={is_active}
                    >
                        {mobile ? (
                            <>
                                <svg
                                    width="20"
                                    height="20"
                                    viewBox={option.viewbox}
                                    fill={is_active ? option.bg : colors.buttons.utility}
                                    aria-hidden="true"
                                >
                                    <path d={option.icon} />
                                </svg>
                                <span className="text-xs font-semibold">
                                    {{ "Band Bar": "Band", DXpeditions: "DX" }[option.label] ??
                                        option.label}
                                </span>
                            </>
                        ) : (
                            <svg
                                width={option.size}
                                height={option.size}
                                viewBox={option.viewbox}
                                fill={is_active ? option.bg : colors.buttons.utility}
                            >
                                <title>{option.label || "View option"}</title>
                                <path d={option.icon} />
                            </svg>
                        )}
                    </div>
                );
            })}
            {!mobile && <div className="w-18 shrink-0" />}
        </div>
    );
}

function SidePanel({
    visible,
    mobile = false,
    overlay,
    on_close,
    on_open,
    set_cat_to_spot,
    active_view,
    set_active_view,
}) {
    const { colors } = useColors();
    const [mobile_view, set_mobile_view] = useLocalStorage("mobile_tools_view", 1);
    const set_displayed_view = mobile ? set_mobile_view : set_active_view;

    useEffect(() => {
        function select_tab(event) {
            const index = view_options.findIndex(option => option.label === event.detail?.label);
            if (index >= 0) set_displayed_view(index);
        }

        document.addEventListener(TOUR_SELECT_SIDE_PANEL_TAB_EVENT, select_tab);
        return () => document.removeEventListener(TOUR_SELECT_SIDE_PANEL_TAB_EVENT, select_tab);
    }, [set_displayed_view]);

    if (active_view === null && !mobile) return null;
    const numeric_mobile_view = Number(mobile_view);
    const displayed_view =
        mobile && [1, 2, 3, 4, 5].includes(numeric_mobile_view)
            ? numeric_mobile_view
            : mobile
              ? 1
              : active_view;

    function handle_import_complete() {
        on_open();
    }

    const content = [
        <Filters key="filters" />,
        <FrequencyBar
            key="frequency-bar"
            set_cat_to_spot={set_cat_to_spot}
            className={"px-2 h-full"}
        />,
        <div key="heatmap" className="p-2">
            <Heatmap />
        </div>,
        <DXpeditions key="dxpeditions" />,
        <MissingPanel key="missing" on_import_complete={handle_import_complete} />,
        <WebsiteTour key="tours" is_mobile launcher_inline />,
    ];
    const active_view_label = view_options[displayed_view]?.label
        .toLowerCase()
        .replaceAll(" ", "-");

    const panel_classes = visible ? (overlay ? "absolute right-0 top-0 flex" : "flex") : "hidden";
    return (
        <aside
            id="tools-panel"
            aria-label="Tools"
            className={`${panel_classes} flex-col h-full min-w-0 z-50 max-h-full overflow-auto`}
            data-tour="side-panel"
            style={{ backgroundColor: colors.theme.background, maxWidth: "100vw" }}
        >
            {overlay && (
                <div
                    className="flex shrink-0 items-center justify-between border-b px-3 py-1"
                    style={{ color: colors.theme.text, borderColor: colors.theme.borders }}
                >
                    <span className="text-sm font-semibold">Tools</span>
                    <button
                        id="tools-panel-close"
                        type="button"
                        aria-label="Close Tools"
                        onClick={on_close}
                        className="cursor-pointer rounded px-3 py-1 text-xl"
                    >
                        ×
                    </button>
                </div>
            )}
            <ViewSelectorTabs
                mobile={mobile}
                active_view={displayed_view}
                set_active_view={set_displayed_view}
                colors={colors}
            />
            <div className="flex flex-1 overflow-hidden" data-tour="side-panel-body">
                <div
                    className="flex-1 overflow-y-auto divide-y divide-slate-300 w-64 min-w-0"
                    data-tour={active_view_label ? `side-panel-view-${active_view_label}` : null}
                >
                    {mobile
                        ? content.map(
                              (view, index) =>
                                  index > 0 && (
                                      <div
                                          key={view.key}
                                          className={displayed_view === index ? "h-full" : "hidden"}
                                      >
                                          {view}
                                      </div>
                                  ),
                          )
                        : content[active_view]}
                </div>
                {!mobile && <RightColumnContent colors={colors} />}
            </div>
        </aside>
    );
}

export default SidePanel;

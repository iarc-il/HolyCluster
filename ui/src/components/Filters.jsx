import Input from "@/components/Input.jsx";
import Button from "@/components/Button.jsx";
import X from "@/components/X.jsx";
import { empty_filter_data, default as FilterModal } from "@/components/FilterModal.jsx";

import { useColors } from "../hooks/useColors";
import { useFilters } from "../hooks/useFilters";

function Indicator({ text }) {
    return (
        <div className="flex border border-gray-700 items-center justify-center p-2 w-7 h-7 rounded-md mr-2 text-xs font-bold bg-green-600 text-white">
            {text}
        </div>
    );
}

function EditSymbol({ size }) {
    const { colors } = useColors();

    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <path
                d="M21.2799 6.40005L11.7399 15.94C10.7899 16.89 7.96987 17.33 7.33987 16.7C6.70987 16.07 7.13987 13.25 8.08987 12.3L17.6399 2.75002C17.8754 2.49308 18.1605 2.28654 18.4781 2.14284C18.7956 1.99914 19.139 1.92124 19.4875 1.9139C19.8359 1.90657 20.1823 1.96991 20.5056 2.10012C20.8289 2.23033 21.1225 2.42473 21.3686 2.67153C21.6147 2.91833 21.8083 3.21243 21.9376 3.53609C22.0669 3.85976 22.1294 4.20626 22.1211 4.55471C22.1128 4.90316 22.0339 5.24635 21.8894 5.5635C21.7448 5.88065 21.5375 6.16524 21.2799 6.40005V6.40005Z"
                stroke={colors.buttons.utility}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M11 4H6C4.93913 4 3.92178 4.42142 3.17163 5.17157C2.42149 5.92172 2 6.93913 2 8V18C2 19.0609 2.42149 20.0783 3.17163 20.8284C3.92178 21.5786 4.93913 22 6 22H17C19.21 22 20 20.2 20 18V13"
                stroke={colors.buttons.utility}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function FilterLine({ filter, id }) {
    const { colors } = useColors();
    const { callsign_filters, setCallsignFilters } = useFilters();

    let filter_type_label;
    if (filter.type == "prefix") {
        filter_type_label = "Pfx";
    } else if (filter.type == "suffix") {
        filter_type_label = "Sfx";
    } else if (filter.type == "entity") {
        filter_type_label = "Ent";
    }

    let spotter_or_dx_label;
    if (filter.spotter_or_dx == "spotter") {
        spotter_or_dx_label = "DE";
    } else if (filter.spotter_or_dx == "dx") {
        spotter_or_dx_label = "DX";
    }

    return (
        <div
            className="flex justify-around items-center mb-1 w-full"
            style={{ color: colors.theme.text }}
        >
            <Input
                className="h-7 text-sm mr-1 w-20"
                disabled
                disabled_text_color={colors.theme.text}
                title={filter.value}
                value={filter.value}
            />
            <Indicator text={filter_type_label} />
            <Indicator text={spotter_or_dx_label} />
            <FilterModal
                initial_data={filter}
                button={<EditSymbol size="24"></EditSymbol>}
                on_apply={new_filter => {
                    const new_filters = [...callsign_filters.filters];
                    new_filters[id] = new_filter;
                    setCallsignFilters({ ...callsign_filters, filters: new_filters });
                }}
            />
            <X
                className="cursor-pointer"
                size="24"
                on_click={() => {
                    const new_filters = [...callsign_filters.filters];
                    new_filters.splice(id, 1);
                    setCallsignFilters({ ...callsign_filters, filters: new_filters });
                }}
            />
            <br />
        </div>
    );
}

function FilterSection({ title, filters, action }) {
    const { callsign_filters, setCallsignFilters } = useFilters();
    let empty_with_action = { ...empty_filter_data, action: action };

    return (
        <div className="pt-2">
            <div className="flex justify-between pb-3">
                <h3 className="text-2xl w-fit inline">{title}</h3>
                <div className="">
                    <FilterModal
                        initial_data={empty_with_action}
                        button={<Button>Add</Button>}
                        on_apply={new_filter => {
                            setCallsignFilters({
                                ...callsign_filters,
                                filters: [...callsign_filters.filters, new_filter],
                            });
                        }}
                    />
                </div>
            </div>
            {filters.map(([id, filter]) => {
                return (
                    <FilterLine
                        key={id}
                        id={id}
                        filter={filter}
                        filter_type={filter.type}
                        spotter_or_dx={filter.spotter_or_dx}
                    />
                );
            })}
        </div>
    );
}

function Filters({}) {
    const { colors } = useColors();
    const { callsign_filters } = useFilters();

    const id_to_filter = callsign_filters.filters.map((filter, index) => [index, filter]);

    let alerts = id_to_filter.filter(([id, filter]) => filter.action == "alert");
    let show_only = id_to_filter.filter(([id, filter]) => filter.action == "show_only");
    let hide = id_to_filter.filter(([id, filter]) => filter.action == "hide");

    return (
        <div className="p-2" style={{ color: colors.theme.text }}>
            <div className="divide-y divide-slate-300 space-y-6">
                <FilterSection title="Alert" action="alert" filters={alerts} />
                <FilterSection title="Show Only" action="show_only" filters={show_only} />
                <FilterSection title="Hide" action="hide" filters={hide} />
            </div>
        </div>
    );
}

export default Filters;

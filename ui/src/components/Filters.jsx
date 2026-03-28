import Input from "@/components/ui/Input.jsx";
import Button from "@/components/ui/Button.jsx";
import Toggle from "@/components/ui/Toggle.jsx";
import X from "@/components/ui/X.jsx";
import { empty_filter_data, default as FilterModal } from "@/components/FilterModal.jsx";

import { useColors } from "@/hooks/useColors";
import { useFilters } from "@/hooks/useFilters";
import { useState } from "react";
import { DndContext, DragOverlay, useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

const FILTER_TYPE_LABELS = {
    prefix: "Pfx",
    suffix: "Sfx",
    entity: "Ent",
};

const SPOTTER_DX_LABELS = {
    spotter: "DE",
    dx: "DX",
};

const SPECIAL_FILTER_LABELS = {
    self_spotters: "Self spotters",
    dxpeditions: "DXpedition",
    missing_dxcc: "Needed DXCC",
};

function Indicator({ text }) {
    return (
        <div className="flex border border-gray-700 items-center justify-center px-1.5 py-2 h-7 rounded-md mr-1 text-base bg-green-600 text-white">
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

function SpecialFilterBadge({ type, listeners, attributes }) {
    const label = SPECIAL_FILTER_LABELS[type];
    return (
        <div
            {...listeners}
            {...attributes}
            className="flex border border-gray-700 items-center justify-center px-2 h-7 rounded-md text-base bg-green-600 text-white cursor-grab active:cursor-grabbing"
        >
            {label}
        </div>
    );
}

function FilterContent({ filter, listeners, attributes, colors }) {
    const is_special_filter =
        filter.type === "self_spotters" ||
        filter.type === "dxpeditions" ||
        filter.type === "missing_dxcc";

    if (is_special_filter) {
        return (
            <SpecialFilterBadge type={filter.type} listeners={listeners} attributes={attributes} />
        );
    }

    return (
        <>
            <div {...listeners} {...attributes}>
                <Input
                    className="h-7 text-base mr-1 w-24 cursor-grab active:cursor-grabbing"
                    disabled
                    disabled_text_color={colors.theme.text}
                    title={filter.value}
                    value={filter.value}
                />
            </div>
            <Indicator text={FILTER_TYPE_LABELS[filter.type]} />
            <Indicator text={SPOTTER_DX_LABELS[filter.spotter_or_dx]} />
        </>
    );
}

function FilterLine({ filter, id, is_dragging }) {
    const { colors } = useColors();
    const { callsign_filters, setCallsignFilters } = useFilters();

    const { attributes, listeners, setNodeRef, transform } = useDraggable({
        id: `filter-${id}`,
        data: { filterId: id, currentAction: filter.action, filter: filter },
    });

    const style = {
        transform: CSS.Translate.toString(transform),
        opacity: is_dragging ? 0.5 : 1,
        color: colors.theme.text,
    };

    const update_filter = new_filter => {
        const new_filters = [...callsign_filters.filters];
        new_filters[id] = new_filter;
        setCallsignFilters({ ...callsign_filters, filters: new_filters });
    };

    const delete_filter = () => {
        const new_filters = [...callsign_filters.filters];
        new_filters.splice(id, 1);
        setCallsignFilters({ ...callsign_filters, filters: new_filters });
    };

    return (
        <div ref={setNodeRef} className="flex items-center mb-1 w-full" style={style}>
            <div className="flex items-center flex-1 min-w-0">
                <FilterContent
                    filter={filter}
                    listeners={listeners}
                    attributes={attributes}
                    colors={colors}
                />
            </div>
            <div className="flex items-center gap-1 ml-2">
                <FilterModal
                    initial_data={filter}
                    button={<EditSymbol size="24" />}
                    on_apply={update_filter}
                />
                <X className="cursor-pointer min-w-[24px]" size="24" on_click={delete_filter} />
            </div>
        </div>
    );
}

function FilterSection({ title, filters, action, toggle_field, active_filter_id }) {
    const { colors } = useColors();
    const { callsign_filters, setCallsignFilters } = useFilters();
    const { setNodeRef, isOver } = useDroppable({ id: action });

    const drop_zone_inner_style = {
        backgroundColor: isOver ? `${colors.theme.accent}20` : "transparent",
        border: isOver ? `2px solid ${colors.theme.accent}` : "2px solid transparent",
        borderRadius: "0.375rem",
        padding: "0.5rem",
        margin: "-0.5rem",
        transition: "all 0.2s ease",
    };

    const toggle_active = () => {
        setCallsignFilters({
            ...callsign_filters,
            [toggle_field]: !callsign_filters[toggle_field],
        });
    };

    const add_filter = new_filter => {
        setCallsignFilters({
            ...callsign_filters,
            filters: [...callsign_filters.filters, new_filter],
        });
    };

    return (
        <div className="pt-2">
            <div ref={setNodeRef} style={drop_zone_inner_style}>
                <div className="flex justify-between pb-3">
                    <h3 className="text-lg w-fit inline">{title}</h3>
                    <div className="flex justify-end space-x-3">
                        <Toggle value={callsign_filters[toggle_field]} on_click={toggle_active} />
                        <FilterModal
                            initial_data={{ ...empty_filter_data, action }}
                            button={<Button className="h-7 flex items-center">Add</Button>}
                            on_apply={add_filter}
                        />
                    </div>
                </div>
                {filters.map(([id, filter]) => (
                    <FilterLine
                        key={id}
                        id={id}
                        filter={filter}
                        is_dragging={active_filter_id === `filter-${id}`}
                    />
                ))}
            </div>
        </div>
    );
}

function Filters() {
    const { colors } = useColors();
    const { callsign_filters, setCallsignFilters } = useFilters();
    const [active_id, set_active_id] = useState(null);

    const filters_by_action = callsign_filters.filters.reduce(
        (acc, filter, index) => {
            acc[filter.action].push([index, filter]);
            return acc;
        },
        { alert: [], show_only: [], hide: [] },
    );

    const handle_drag_start = event => {
        set_active_id(event.active.id);
    };

    const handle_drag_end = event => {
        const { active, over } = event;
        set_active_id(null);

        if (!over) return;

        const { filterId, currentAction } = active.data.current;
        const newAction = over.id;

        if (currentAction !== newAction) {
            const new_filters = [...callsign_filters.filters];
            new_filters[filterId] = { ...new_filters[filterId], action: newAction };
            setCallsignFilters({ ...callsign_filters, filters: new_filters });
        }
    };

    const handleDragCancel = () => {
        set_active_id(null);
    };

    const activeFilter = active_id
        ? callsign_filters.filters[Number.parseInt(active_id.replace("filter-", ""))]
        : null;

    return (
        <DndContext
            onDragStart={handle_drag_start}
            onDragEnd={handle_drag_end}
            onDragCancel={handleDragCancel}
        >
            <div className="p-2 flex flex-col h-full" style={{ color: colors.theme.text }}>
                <div className="divide-y divide-slate-300 space-y-6">
                    <FilterSection
                        title="Alert"
                        action="alert"
                        filters={filters_by_action.alert}
                        toggle_field="is_alert_filters_active"
                        active_filter_id={active_id}
                    />
                    <FilterSection
                        title="Show Only"
                        action="show_only"
                        filters={filters_by_action.show_only}
                        toggle_field="is_show_only_filters_active"
                        active_filter_id={active_id}
                    />
                    <FilterSection
                        title="Hide"
                        action="hide"
                        filters={filters_by_action.hide}
                        toggle_field="is_hide_filters_active"
                        active_filter_id={active_id}
                    />
                </div>
            </div>
            <DragOverlay>
                {active_id && activeFilter && (
                    <div
                        className="flex items-center mb-1 w-full opacity-90 shadow-lg"
                        style={{
                            color: colors.theme.text,
                            backgroundColor: colors.theme.background,
                            padding: "0.25rem",
                            borderRadius: "0.375rem",
                        }}
                    >
                        <div className="flex items-center flex-1 min-w-0">
                            <FilterContent filter={activeFilter} colors={colors} />
                        </div>
                    </div>
                )}
            </DragOverlay>
        </DndContext>
    );
}

export default Filters;

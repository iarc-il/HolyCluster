import { useMemo, useRef, useState } from "react";

import { useMeasure, useMediaQuery } from "@uidotdev/usehooks";
import haversine from "haversine-distance";
import Maidenhead from "maidenhead";

import SpotContextMenu from "@/components/SpotContextMenu.jsx";
import SpotPopup from "@/components/SpotPopup.jsx";
import Popup from "@/components/ui/Popup.jsx";
import { is_filterable_dxcc_entity } from "@/data/dxcc_entities.js";
import { useColors } from "@/hooks/useColors";
import { useFilters } from "@/hooks/useFilters";
import { useSettings } from "@/hooks/useSettings";
import { useSpotData } from "@/hooks/useSpotData";
import { useSpotInteraction } from "@/hooks/useSpotInteraction";
import { useVoacap } from "@/hooks/useVoacap.jsx";
import { calculate_geographic_azimuth } from "@/utils.js";
import MapOverlay from "./MapOverlay.jsx";
import { Dimensions } from "./dimensions.js";
import {
    MAP_FILTER_ACTIONS,
    build_filter_menu_actions,
    build_map_context_filter,
} from "./map_context_menu.js";
import { DPR } from "./render_helpers.js";
import { useCanvasLayers } from "./useCanvasLayers.js";
import { useMapGestures } from "./useMapGestures.js";
import { useMapHitTest } from "./useMapHitTest.js";
import { useMapProjection } from "./useMapProjection.js";
import { useMapRedraw } from "./useMapRedraw.js";

function CanvasMap({
    map_controls,
    set_map_controls,
    set_cat_to_spot,
    radius_in_km,
    set_radius_in_km,
    auto_radius,
    set_auto_radius,
    night_time = null,
}) {
    const { spots, current_freq_spots } = useSpotData();
    const { callsign_filters, get_filter_add_status, add_filter_if_allowed } = useFilters();
    const { hovered_spot, set_hovered_spot, pinned_spot, set_pinned_spot, hovered_band } =
        useSpotInteraction();
    const { settings } = useSettings();
    const { colors } = useColors();
    const [hovered_zone, set_hovered_zone] = useState({ system: null, number: null });
    const [hovered_dxcc, set_hovered_dxcc] = useState(null);
    const [map_context_menu, set_map_context_menu] = useState({
        visible: false,
        x: 0,
        y: 0,
        type: null,
        system: null,
        number: null,
        entity: null,
        is_filterable_entity: false,
    });

    const animation_id_ref = useRef(null);
    const dxcc_popup_anchor_ref = useRef(null);
    const hit_test_ref = useRef(null);

    const gesture_active_ref = useRef(false);

    const map_menu_has_invalid_dxcc_entity =
        map_context_menu.type === "dxcc" && !map_context_menu.is_filterable_entity;
    const map_menu_actions = build_filter_menu_actions(
        MAP_FILTER_ACTIONS,
        action =>
            build_map_context_filter(
                action,
                map_context_menu.type,
                map_context_menu.entity,
                map_context_menu.number,
                map_context_menu.system,
            ),
        map_context_menu.type === "dxcc" ? map_context_menu.entity : null,
        map_menu_has_invalid_dxcc_entity,
        map_menu_has_invalid_dxcc_entity ? "Unmapped DXCC" : null,
        get_filter_add_status,
        add_filter_if_allowed,
    );

    const [div_ref, { width, height }] = useMeasure();

    const is_max_xs_device = useMediaQuery("only screen and (max-width : 500px)");
    const is_sm_device = useMediaQuery("only screen and (min-width : 640px)");
    const inner_padding = is_sm_device && !map_controls.is_globe ? 45 : 5;

    const dims = useMemo(
        () => (width && height ? new Dimensions(width, height, inner_padding) : null),
        [width, height, inner_padding],
    );

    const [center_lon, center_lat] = map_controls.location.location;
    const voacap_state = useVoacap({
        enabled: map_controls.voacap_enabled ?? false,
        center_lat,
        center_lon,
        band: map_controls.voacap_band ?? "20",
        step_deg: map_controls.voacap_step_deg ?? 10,
    });
    const voacap_render_state =
        map_controls.voacap_enabled && !voacap_state.loading && !voacap_state.stale
            ? voacap_state
            : null;
    const home_location = useMemo(() => {
        const locator = (settings.locator || "").trim().toUpperCase();
        if (!locator || !Maidenhead.valid(locator)) return null;
        const [lat, lon] = Maidenhead.toLatLon(locator);
        return [lon, lat];
    }, [settings.locator]);
    const night_time_ms = night_time?.getTime() ?? null;

    const render_state_ref = useRef({});
    render_state_ref.current = {
        spots,
        colors,
        hovered_spot,
        pinned_spot,
        hovered_band,
        current_freq_spots,
        map_controls,
        settings,
        radius_in_km,
        callsign_filters,
        hovered_zone,
        hovered_dxcc,
        home_location,
        night_time,
        voacap: voacap_render_state,
    };

    const {
        map_canvas_ref,
        voacap_canvas_ref,
        spots_canvas_ref,
        shadow_canvas_ref,
        canvas_refs,
        dash_offset_ref,
        shadow_render_state_ref,
    } = useCanvasLayers(dims);

    const { projection_ref, base_scale_ref } = useMapProjection(
        dims,
        center_lon,
        center_lat,
        radius_in_km,
        map_controls.is_globe,
        gesture_active_ref,
    );

    const hit_test = useMapHitTest(shadow_canvas_ref, projection_ref, render_state_ref);
    hit_test_ref.current = hit_test;

    useMapRedraw({
        dims,
        projection_ref,
        canvas_refs,
        render_state_ref,
        gesture_active_ref,
        center_lon,
        center_lat,
        radius_in_km,
        map_controls,
        callsign_filters,
        colors,
        night_time_ms,
        spots,
        hovered_spot,
        pinned_spot,
        hovered_band,
        current_freq_spots,
        hovered_zone,
        hovered_dxcc,
        home_location,
        voacap_state,
        animation_id_ref,
    });

    const { container_ref } = useMapGestures({
        dims,
        projection_ref,
        base_scale_ref,
        canvas_refs,
        render_state_ref,
        gesture_active_ref,
        hit_test_ref,
        set_auto_radius,
        set_radius_in_km,
        set_hovered_zone,
        set_hovered_dxcc,
        callbacks: {
            set_map_controls,
            set_cat_to_spot,
            set_hovered_spot,
            set_pinned_spot,
            add_filter_if_allowed,
            open_zone_context_menu: (x, y, system, number) => {
                set_map_context_menu({
                    visible: true,
                    x,
                    y,
                    type: "zone",
                    system,
                    number,
                    entity: null,
                    is_filterable_entity: false,
                });
            },
            open_dxcc_context_menu: (x, y, entity) => {
                set_map_context_menu({
                    visible: true,
                    x,
                    y,
                    type: "dxcc",
                    system: null,
                    number: null,
                    entity,
                    is_filterable_entity: is_filterable_dxcc_entity(entity),
                });
            },
        },
    });

    // Compute azimuth for hovered/pinned spot
    const hovered_spot_data = spots.find(spot => spot.id === hovered_spot.id);
    const pinned_spot_data = spots.find(spot => spot.id === pinned_spot);

    const hovered_spot_distance =
        hovered_spot_data != null
            ? (haversine(hovered_spot_data.dx_loc, hovered_spot_data.spotter_loc) / 1000).toFixed()
            : null;

    const pinned_spot_distance =
        pinned_spot_data != null
            ? (haversine(pinned_spot_data.dx_loc, pinned_spot_data.spotter_loc) / 1000).toFixed()
            : null;

    let azimuth = null;
    if (hovered_spot_data || pinned_spot_data) {
        const spot_data = hovered_spot_data || pinned_spot_data;
        azimuth = calculate_geographic_azimuth(
            center_lat,
            center_lon,
            spot_data.dx_loc[1],
            spot_data.dx_loc[0],
        );
    }

    const canvas_width = width ? width * DPR : 0;
    const canvas_height = height ? height * DPR : 0;
    const canvas_style = width && height ? { width: `${width}px`, height: `${height}px` } : {};

    return (
        <div
            ref={node => {
                container_ref.current = node;
                div_ref(node);
            }}
            className="relative h-full w-full"
            style={{
                backgroundColor: colors.theme.background,
                touchAction: "none",
                userSelect: "none",
                cursor:
                    (hovered_zone.system != null && hovered_zone.number != null) ||
                    hovered_dxcc != null
                        ? "pointer"
                        : "default",
            }}
        >
            <canvas
                className="absolute top-0 left-0"
                ref={map_canvas_ref}
                width={canvas_width}
                height={canvas_height}
                style={canvas_style}
            />
            <canvas
                className="absolute top-0 left-0"
                ref={voacap_canvas_ref}
                width={canvas_width}
                height={canvas_height}
                style={canvas_style}
            />
            <canvas
                className="absolute top-0 left-0"
                ref={spots_canvas_ref}
                width={canvas_width}
                height={canvas_height}
                style={canvas_style}
            />
            <MapOverlay
                dims={dims}
                colors={colors}
                settings={settings}
                map_controls={map_controls}
                radius_in_km={radius_in_km}
                auto_radius={auto_radius}
                set_auto_radius={set_auto_radius}
                azimuth={azimuth}
                spots={spots}
                is_max_xs_device={is_max_xs_device}
                voacap_state={voacap_state}
            />
            {(pinned_spot_data || hovered_spot_data) && (
                <SpotPopup
                    hovered_spot={hovered_spot}
                    set_hovered_spot={set_hovered_spot}
                    set_pinned_spot={set_pinned_spot}
                    hovered_spot_data={hovered_spot_data}
                    pinned_spot_data={pinned_spot_data}
                    distance={hovered_spot_distance ?? pinned_spot_distance}
                    azimuth={azimuth}
                />
            )}
            {hovered_dxcc?.entity && (
                <div
                    ref={dxcc_popup_anchor_ref}
                    className="absolute pointer-events-none w-0 h-0"
                    style={{
                        left: `${hovered_dxcc.x}px`,
                        top: `${hovered_dxcc.y}px`,
                    }}
                />
            )}
            {hovered_dxcc?.entity && !map_context_menu.visible && (
                <Popup anchor_ref={dxcc_popup_anchor_ref} keep_in_view={true} vertical_offset={-12}>
                    <div
                        className="py-1 px-2 rounded shadow-lg text-xs whitespace-nowrap"
                        style={{
                            color: colors.theme.text,
                            background: colors.theme.background,
                        }}
                    >
                        {hovered_dxcc.entity}
                    </div>
                </Popup>
            )}
            {map_context_menu.visible && (
                <SpotContextMenu
                    x={map_context_menu.x}
                    y={map_context_menu.y}
                    spot={null}
                    on_close={() => set_map_context_menu(state => ({ ...state, visible: false }))}
                    actions={map_menu_actions}
                />
            )}
        </div>
    );
}

export default CanvasMap;

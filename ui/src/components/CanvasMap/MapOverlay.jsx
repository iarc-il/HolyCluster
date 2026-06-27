import MapAngles from "@/components/MapAngles.jsx";
import ToggleSVG from "@/components/ui/ToggleSVG";
import { km_to_miles } from "@/utils.js";

export default function MapOverlay({
    dims,
    colors,
    settings,
    map_controls,
    radius_in_km,
    auto_radius,
    set_auto_radius,
    azimuth,
    spots,
    is_max_xs_device,
    voacap_state,
}) {
    const text_height = 20;
    const text_x = is_max_xs_device ? 10 : 20;
    const text_y = is_max_xs_device ? 20 : 30;

    const show_voacap_legend = map_controls.voacap_enabled ?? false;
    const voacap_band_label = `${map_controls.voacap_band ?? "20"}m`;
    const voacap_frequency_mhz = Number(voacap_state.data?.frequency_mhz);
    const voacap_status = voacap_state.error
        ? voacap_state.stale
            ? `Stale: ${voacap_state.error}`
            : voacap_state.error
        : voacap_state.loading
          ? voacap_state.stale
              ? "Updating..."
              : "Loading..."
          : voacap_state.data
            ? `${voacap_state.data.cells?.length ?? 0} samples`
            : voacap_state.url
              ? "Queued"
              : "No request";

    return (
        <>
            <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
                <title>Map overlay</title>
                <g className="font-medium text-lg select-none">
                    <text x={text_x} y={text_y} fill={colors.theme.text}>
                        Radius: {settings.is_miles ? km_to_miles(radius_in_km) : radius_in_km}{" "}
                        {settings.is_miles ? "Miles" : "KM"}
                        {!map_controls.is_globe ? " | Auto" : ""}
                    </text>

                    {!map_controls.is_globe && (
                        <foreignObject
                            x={text_x + 220}
                            y={text_y - 18}
                            width="67"
                            height="40"
                            className="pointer-events-auto"
                        >
                            <div xmlns="http://www.w3.org/1999/xhtml">
                                <ToggleSVG
                                    auto_radius={auto_radius}
                                    set_auto_radius={set_auto_radius}
                                />
                            </div>
                        </foreignObject>
                    )}

                    <text x={text_x} y={text_y + text_height} fill={colors.theme.text}>
                        Center: {map_controls.location.displayed_locator}
                    </text>

                    <text x={text_x} y={text_y + 2 * text_height} fill={colors.theme.text}>
                        Spots: {spots.length}
                    </text>
                </g>
                {dims && !map_controls.is_globe && (
                    <MapAngles
                        radius={dims.radius + 25 * dims.scale}
                        center_x={dims.center_x}
                        center_y={dims.center_y}
                        degrees_diff={15}
                        hovered_azimuth={azimuth}
                    />
                )}
            </svg>
            {show_voacap_legend && (
                <div
                    className="absolute bottom-3 left-1/2 z-20 pointer-events-none flex -translate-x-1/2 items-center gap-2 rounded-full px-2 py-1 text-[10px] shadow-lg select-none"
                    style={{
                        color: colors.theme.text,
                        backgroundColor: colors.theme.background,
                        border: `1px solid ${colors.theme.borders}`,
                    }}
                    title={
                        voacap_state.url ? `${voacap_status}: ${voacap_state.url}` : voacap_status
                    }
                >
                    <span className="whitespace-nowrap font-semibold">
                        VOACAP {voacap_band_label}
                    </span>
                    <div
                        className="h-2 w-24 rounded"
                        style={{
                            background:
                                "linear-gradient(to right, rgba(0,0,80,0), blue, cyan, lime, yellow, red)",
                            border: `1px solid ${colors.theme.borders}`,
                        }}
                    />
                    {Number.isFinite(voacap_frequency_mhz) && (
                        <span className="whitespace-nowrap opacity-80">
                            {voacap_frequency_mhz.toFixed(2)} MHz
                        </span>
                    )}
                    <span className="max-w-24 truncate opacity-80">{voacap_status}</span>
                </div>
            )}
        </>
    );
}

export const MODE_SHAPE = {
    SSB: "square",
    CW: "triangle",
    FT8: "hexagon",
    FT4: "hexagon",
    DIGI: "hexagon",
    RTTY: "hexagon",
};

export function get_mode_shape(mode) {
    return MODE_SHAPE[mode?.toUpperCase()] ?? "hexagon";
}

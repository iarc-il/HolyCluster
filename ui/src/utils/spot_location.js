function is_valid_location(location) {
    return (
        Array.isArray(location) &&
        location.length === 2 &&
        location.every(Number.isFinite) &&
        Math.abs(location[0]) <= 180 &&
        Math.abs(location[1]) <= 90
    );
}

export function has_valid_spot_locations(spot) {
    return is_valid_location(spot?.dx_loc) && is_valid_location(spot?.spotter_loc);
}

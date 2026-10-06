const KEY = "live_spot_snapshot_v1";
const MAX_AGE_MS = 5 * 60 * 1000;
const MAX_SPOTS = 500;

function valid_spot(spot, now) {
    return (
        spot &&
        Number.isFinite(spot.time) &&
        spot.time > now / 1000 - 3600 &&
        spot.time <= now / 1000 + 60 &&
        Number.isFinite(spot.freq) &&
        Number.isFinite(spot.dx_dxcc_code) &&
        Number.isFinite(spot.spotter_dxcc_code) &&
        [
            spot.id,
            spot.dx_callsign,
            spot.spotter_callsign,
            spot.mode,
            spot.dx_continent,
            spot.spotter_continent,
        ].every(value => typeof value === "string") &&
        [spot.dx_loc, spot.spotter_loc].every(
            location =>
                Array.isArray(location) && location.length === 2 && location.every(Number.isFinite),
        ) &&
        (typeof spot.band === "number" || typeof spot.band === "string") &&
        (spot.comment == null || typeof spot.comment === "string")
    );
}

export function read_live_spot_snapshot() {
    try {
        const snapshot = JSON.parse(localStorage.getItem(KEY));
        const now = Date.now();
        if (
            !Number.isFinite(snapshot?.saved_at) ||
            snapshot.saved_at > now ||
            now - snapshot.saved_at > MAX_AGE_MS ||
            !Array.isArray(snapshot.spots)
        ) {
            return [];
        }
        return snapshot.spots.slice(0, MAX_SPOTS).filter(spot => valid_spot(spot, now));
    } catch {
        return [];
    }
}

export function write_live_spot_snapshot(spots) {
    try {
        localStorage.setItem(
            KEY,
            JSON.stringify({ saved_at: Date.now(), spots: spots.slice(0, MAX_SPOTS) }),
        );
    } catch {}
}

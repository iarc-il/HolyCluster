export function create_server_clock({
    wall_now = () => Date.now(),
    monotonic_now = () => performance.now(),
} = {}) {
    let anchor = null;

    return {
        synchronize(server_time) {
            if (!Number.isFinite(server_time) || server_time <= 0) return false;
            anchor = {
                server_time_ms: server_time * 1000,
                monotonic_time_ms: monotonic_now(),
            };
            return true;
        },
        now_ms() {
            if (!anchor) return wall_now();
            return anchor.server_time_ms + monotonic_now() - anchor.monotonic_time_ms;
        },
        is_server_time() {
            return anchor !== null;
        },
    };
}

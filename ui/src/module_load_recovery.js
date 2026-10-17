const reload_marker = "holycluster_preload_reload_release";

export function install_module_load_recovery({
    events = window,
    release = import.meta.env.VITE_SENTRY_RELEASE,
    reload = () => window.location.reload(),
    storage = window.sessionStorage,
} = {}) {
    if (!release) return () => {};

    try {
        if (storage.getItem(reload_marker) !== release) {
            storage.removeItem(reload_marker);
        }
    } catch {
        return () => {};
    }

    function recover(event) {
        try {
            if (storage.getItem(reload_marker) === release) return;
            storage.setItem(reload_marker, release);
        } catch {
            return;
        }

        event.preventDefault();
        reload();
    }

    events.addEventListener("vite:preloadError", recover);
    return () => events.removeEventListener("vite:preloadError", recover);
}

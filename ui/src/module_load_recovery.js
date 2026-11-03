export async function detect_ui_build({ entry, signal, on_diagnostic } = {}) {
    function asset_url(value) {
        try {
            const url = new URL(value, window.location.origin);
            return (
                url.origin === window.location.origin &&
                /^\/assets\/[A-Za-z0-9_-]+\.js$/.test(url.pathname) &&
                !url.search &&
                !url.hash &&
                (value === url.pathname || value === url.href)
            );
        } catch {
            return false;
        }
    }

    const diagnostic = {
        page_entry: asset_url(entry) ? entry : null,
        probed_entry: null,
        probe_outcome: "not_started",
        probe_status: null,
        probe_content_type: null,
        probe_reason: "invalid_page_entry",
    };
    let emitted = false;
    function emit() {
        if (emitted || typeof on_diagnostic !== "function") return;
        emitted = true;
        try {
            on_diagnostic({ ...diagnostic });
        } catch {}
    }

    if (!diagnostic.page_entry) {
        emit();
        return null;
    }

    let response;
    try {
        response = await fetch(window.location.href, {
            cache: "no-store",
            credentials: "same-origin",
            redirect: "error",
            signal,
            headers: { Accept: "text/html" },
        });
    } catch (error) {
        diagnostic.probe_outcome = signal?.aborted ? "aborted" : "request_failed";
        diagnostic.probe_reason = diagnostic.probe_outcome;
        emit();
        throw error;
    }

    diagnostic.probe_outcome = "response";
    diagnostic.probe_status =
        Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
            ? response.status
            : null;
    const content_type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    diagnostic.probe_content_type = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(content_type)
        ? content_type
        : null;
    if (response.redirected) {
        diagnostic.probe_reason = "redirected";
        emit();
        return null;
    }
    if (!response.ok) {
        diagnostic.probe_reason = "http_error";
        emit();
        return null;
    }
    if (content_type !== "text/html") {
        diagnostic.probe_reason = "not_html";
        emit();
        return null;
    }

    let html;
    try {
        html = await response.text();
    } catch (error) {
        diagnostic.probe_reason = "body_failed";
        emit();
        throw error;
    }
    diagnostic.probe_outcome = "html_parsed";
    const next_document = new DOMParser().parseFromString(html, "text/html");
    const target_entry = next_document.querySelector('meta[name="ui-entry"]')?.content;
    if (!target_entry) {
        diagnostic.probe_reason = "missing_entry";
        emit();
        return null;
    }
    if (!asset_url(target_entry)) {
        diagnostic.probe_reason = "invalid_entry";
        emit();
        return null;
    }
    diagnostic.probed_entry = target_entry;
    if (target_entry === entry) {
        diagnostic.probe_reason = "same_entry";
        emit();
        return null;
    }
    const module = next_document.querySelector('script[type="module"][src]');
    if (module?.getAttribute("src") !== target_entry) {
        diagnostic.probe_reason = "entry_mismatch";
        emit();
        return null;
    }
    diagnostic.probe_reason = "new_build";
    emit();
    return { current_entry: entry, target_entry };
}

export function install_module_load_recovery({
    events = window,
    entry,
    reload = () => window.location.reload(),
    check = detect_ui_build,
    manual = () => {
        const message = document.createElement("div");
        message.setAttribute("role", "alert");
        message.textContent = "HolyCluster could not load. ";
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Reload manually";
        button.addEventListener("click", () => window.location.reload());
        message.append(button);
        document.body.append(message);
    },
} = {}) {
    let pending = false;
    let stopped = false;
    let active_controller;

    async function recover(event) {
        const script = event.target;
        const expected = new URL(entry, window.location.origin).href;
        const initial_failure =
            event.type === "error" &&
            script instanceof HTMLScriptElement &&
            script.type === "module" &&
            script.src === expected;
        if (!initial_failure || pending || stopped) return;
        event.preventDefault();
        pending = true;
        const controller = new AbortController();
        active_controller = controller;
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
            const storage = window.sessionStorage;
            storage.setItem("holycluster_ui_navigation_probe", "1");
            storage.removeItem("holycluster_ui_navigation_probe");
            const update = navigator.onLine
                ? await check({ entry, signal: controller.signal })
                : null;
            if (stopped) return;
            if (
                !update ||
                storage.getItem("holycluster_ui_last_auto_target") === update.target_entry
            ) {
                manual();
                return;
            }
            storage.setItem("holycluster_ui_last_auto_target", update.target_entry);
            storage.setItem(
                "holycluster_ui_navigation",
                JSON.stringify({
                    source_entry: update.current_entry,
                    target_entry: update.target_entry,
                }),
            );
            events.dispatchEvent(new Event("holycluster:ui-navigation"));
            reload();
        } catch {
            if (!stopped) manual();
        } finally {
            clearTimeout(timeout);
            pending = false;
        }
    }

    events.addEventListener("error", recover, true);
    return () => {
        stopped = true;
        active_controller?.abort();
        events.removeEventListener("error", recover, true);
    };
}

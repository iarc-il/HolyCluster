import { import_missing_adif } from "@/utils/missing_adif.js";

function create_worker_import_id() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now()}:${Math.random()}`;
}

function create_missing_adif_worker() {
    return new Worker(new URL("./missing_adif_worker.js", import.meta.url), { type: "module" });
}

export function import_missing_adif_in_worker(options = {}) {
    const { on_progress, resolve_callsigns, ...worker_options } = options;

    if (typeof Worker !== "function" || typeof resolve_callsigns === "function") {
        return import_missing_adif(options);
    }

    let worker;
    try {
        worker = create_missing_adif_worker();
    } catch {
        return import_missing_adif(options);
    }

    return new Promise((resolve, reject) => {
        const id = create_worker_import_id();

        function cleanup() {
            worker.terminate();
        }

        worker.onmessage = event => {
            const message = event.data ?? {};
            if (message.id !== id) return;

            if (message.type === "progress") {
                on_progress?.(message.progress);
                return;
            }

            cleanup();
            if (message.type === "success") {
                resolve(message.result);
                return;
            }

            const error = new Error(message.error?.message || "Could not import ADIF file.");
            error.name = message.error?.name || "Error";
            reject(error);
        };

        worker.onerror = event => {
            cleanup();
            reject(new Error(event.message || "Could not import ADIF file."));
        };

        worker.postMessage({ id, options: worker_options });
    });
}

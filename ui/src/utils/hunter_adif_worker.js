import { import_hunter_adif } from "@/utils/hunter_adif.js";

self.onmessage = async event => {
    const { id, options } = event.data ?? {};

    try {
        const result = await import_hunter_adif({
            ...options,
            on_progress: progress => {
                self.postMessage({ id, type: "progress", progress });
            },
        });
        self.postMessage({ id, type: "success", result });
    } catch (error) {
        self.postMessage({
            id,
            type: "error",
            error: {
                name: error.name,
                message: error.message,
            },
        });
    }
};

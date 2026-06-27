import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { ctyDxccEntitiesPlugin } from "./scripts/cty_entities.js";

export default defineConfig({
    plugins: [ctyDxccEntitiesPlugin(), react()],
    worker: {
        plugins: () => [ctyDxccEntitiesPlugin()],
    },
    test: {
        environment: "jsdom",
        include: ["tests/**/*.{js,jsx}"],
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        proxy: {
            "/propagation": "https://holycluster-dev.iarc.org",
            "/locator": "https://holycluster-dev.iarc.org",
            "/catserver": "https://holycluster-dev.iarc.org",
            "/dxpeditions": "https://holycluster-dev.iarc.org",
            "/cluster_stats": "https://holycluster-dev.iarc.org",
            "/history": "https://holycluster-dev.iarc.org",
            "/hunter/resolve": "https://holycluster-dev.iarc.org",
            "/spots_ws": {
                target: "wss://holycluster-dev.iarc.org",
                ws: true,
            },
            "/radio": {
                target: "wss://holycluster-dev.iarc.org",
                ws: true,
            },
            "/submit_spot": {
                target: "wss://holycluster-dev.iarc.org",
                ws: true,
            },
        },
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks: id => {
                    if (id.includes("node_modules")) {
                        return "vendor";
                    }
                    if (id.includes("dxcc_map.json")) {
                        return "dxcc";
                    }
                    if (id.includes("flags.json")) {
                        return "flags";
                    }
                    return "index";
                },
            },
        },
    },
});

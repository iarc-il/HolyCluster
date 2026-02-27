import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
    plugins: [react(), visualizer()],
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
                manualChunks: function (id) {
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

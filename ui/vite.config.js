import path from "node:path";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { ctyDxccEntitiesPlugin } from "./scripts/cty_entities.js";

const glitchtip_url = "https://holycluster-dev.iarc.org/errors/";
const sentry_options = {
    authToken: process.env.SENTRY_AUTH_TOKEN,
    errorHandler: error => {
        throw error;
    },
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    release: {
        name: process.env.SENTRY_RELEASE,
    },
    url: glitchtip_url,
};

const sentry_upload_enabled = Object.values({
    authToken: sentry_options.authToken,
    org: sentry_options.org,
    project: sentry_options.project,
    release: sentry_options.release.name,
    sourceMaps: process.env.SENTRY_UPLOAD_SOURCE_MAPS === "true",
}).every(Boolean);

export default defineConfig(({ mode }) => ({
    plugins: [
        ctyDxccEntitiesPlugin(),
        react(),
        ...(sentry_upload_enabled ? [sentryVitePlugin(sentry_options)] : []),
    ],
    worker: {
        plugins: () => [ctyDxccEntitiesPlugin()],
    },
    test: {
        environment: "jsdom",
        include: ["tests/**/*.{js,jsx}"],
        setupFiles: ["fake-indexeddb/auto"],
        testTimeout: 10000,
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
            "/ws": {
                target: "wss://holycluster-dev.iarc.org",
                ws: true,
            },
        },
    },
    build: {
        sourcemap:
            mode === "production" && process.env.SENTRY_UPLOAD_SOURCE_MAPS === "true"
                ? "hidden"
                : false,
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
}));

import path from "node:path";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { ctyDxccEntitiesPlugin } from "./scripts/cty_entities.js";
import { dxccMapChunkName, dxccMapPlugin } from "./scripts/dxcc_map.js";

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
    url: "https://errors.iarc.org/",
};

const sentry_upload_enabled = Object.values({
    authToken: sentry_options.authToken,
    org: sentry_options.org,
    project: sentry_options.project,
    release: sentry_options.release.name,
    sourceMaps: process.env.SENTRY_UPLOAD_SOURCE_MAPS === "true",
}).every(Boolean);

const catserver_proxy_paths = [
    "/api",
    "/catserver",
    "/dxpeditions",
    "/history",
    "/locator",
    "/propagation",
    "/radio",
    "/spots_ws",
    "/submit_spot",
    "/voacap",
    "/ws",
];

const catserver_proxy = Object.fromEntries(
    catserver_proxy_paths.map(path => [
        path,
        {
            target: "http://127.0.0.1:3000",
            ws: true,
        },
    ]),
);

export default defineConfig(({ mode }) => ({
    plugins: [
        ctyDxccEntitiesPlugin(),
        dxccMapPlugin(),
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
            "@shared": path.resolve(__dirname, "../shared"),
        },
    },
    server: {
        proxy:
            process.env.CATSERVER_PROXY === "true"
                ? catserver_proxy
                : {
                      "/propagation": "https://holycluster-dev.iarc.org",
                      "/locator": "https://holycluster-dev.iarc.org",
                      "/catserver": "https://holycluster-dev.iarc.org",
                      "/dxpeditions": "https://holycluster-dev.iarc.org",
                      "/history": "https://holycluster-dev.iarc.org",
                      "/voacap": "https://holycluster-dev.iarc.org",
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
                    const dxcc_chunk_name = dxccMapChunkName(id);
                    if (dxcc_chunk_name) return dxcc_chunk_name;

                    const dependency_path = id.split("node_modules/")[1];
                    if (dependency_path?.startsWith("@sentry/")) {
                        return "vendor-sentry";
                    }
                    if (/^d3(?:-|\/)/.test(dependency_path)) {
                        return "vendor-d3";
                    }
                    if (
                        /^(?:react|react-dom|react-router|react-router-dom|scheduler|use-sync-external-store)\//.test(
                            dependency_path,
                        )
                    ) {
                        return "vendor-react";
                    }
                    if (dependency_path) {
                        return "vendor";
                    }
                    if (
                        id.includes("/src/hooks/") ||
                        id.includes("/src/data/") ||
                        id.includes("/src/utils/") ||
                        id.endsWith("/src/utils.js")
                    ) {
                        return "app-core";
                    }
                    if (id.includes("flags.json")) {
                        return "flags";
                    }
                },
            },
        },
    },
}));

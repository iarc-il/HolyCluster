import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { ctyDxccEntitiesPlugin } from "./scripts/cty_entities.js";

export default defineConfig({
    plugins: [ctyDxccEntitiesPlugin(), react()],
    resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
    build: {
        outDir: "dist/diagnostics",
        emptyOutDir: true,
        sourcemap: "hidden",
        rollupOptions: { input: "e2e/diagnostics/index.html" },
    },
});

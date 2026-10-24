import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e/integrity",
    testMatch: "**/*.browser.js",
    timeout: 20000,
    workers: 1,
    reporter: "list",
    use: { baseURL: "http://127.0.0.1:5188" },
    webServer: {
        command:
            "vite build --outDir dist/integrity && vite preview --outDir dist/integrity --host 127.0.0.1 --port 5188 --strictPort",
        env: { VITE_SENTRY_DSN: "" },
        url: "http://127.0.0.1:5188",
        reuseExistingServer: false,
    },
    projects: [
        { name: "chromium", use: { ...devices["Desktop Chrome"] } },
        { name: "firefox", use: { ...devices["Desktop Firefox"] } },
        { name: "webkit", use: { ...devices["Desktop Safari"] } },
    ],
});

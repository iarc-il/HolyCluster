import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e/diagnostics",
    testMatch: "**/*.browser.js",
    timeout: 15000,
    fullyParallel: true,
    workers: 3,
    reporter: "list",
    use: { baseURL: "http://127.0.0.1:5187" },
    webServer: {
        command:
            "vite build --config vite.diagnostics.config.js && vite preview --config vite.diagnostics.config.js --host 127.0.0.1 --port 5187 --strictPort",
        url: "http://127.0.0.1:5187/e2e/diagnostics/index.html",
        reuseExistingServer: false,
    },
    projects: [
        { name: "chromium", use: { ...devices["Desktop Chrome"] } },
        { name: "firefox", use: { ...devices["Desktop Firefox"] } },
        { name: "webkit", use: { ...devices["Desktop Safari"] } },
    ],
});

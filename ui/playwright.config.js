import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? "5193";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: "./e2e",
    testIgnore: "**/integrity/**",
    timeout: 60000,
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 2 : 0,
    reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
    use: {
        baseURL,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
    },
    webServer: {
        command: `vite --host 127.0.0.1 --port ${port} --strictPort`,
        env: { VITE_SENTRY_DSN: "" },
        cwd: ".",
        reuseExistingServer: false,
        timeout: 120000,
        url: baseURL,
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
});

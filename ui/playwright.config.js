import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? "5173";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: "./e2e",
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
        command: process.env.CI
            ? `vite preview --host 127.0.0.1 --port ${port}`
            : `vite --host 127.0.0.1 --port ${port}`,
        cwd: ".",
        reuseExistingServer: !process.env.CI,
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

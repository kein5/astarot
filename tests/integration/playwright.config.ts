// The integration tests (ADR-017): the app's screens in Chromium and WebKit, through the real core.
// `python tools/dev.py check --scope integration` builds the core's host and the page first.
import { defineConfig, devices } from "@playwright/test";

const CI = Boolean(process.env.CI);

export default defineConfig({
    testDir: ".",
    testMatch: "*.spec.ts",
    outputDir: "../../build/integration/results",
    // Each test has its own core on its own settings folder and port.
    fullyParallel: true,
    workers: CI ? 2 : undefined,
    retries: 0,
    forbidOnly: CI,
    timeout: 60_000,
    expect: { timeout: 15_000 },
    reporter: CI ? [["list"], ["html", { open: "never", outputFolder: "../../build/integration/report" }]] : "list",
    use: {
        baseURL: "http://127.0.0.1:4317",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        viewport: { width: 1280, height: 800 },
        locale: "en-US",
    },
    webServer: {
        command: "node ../../node_modules/vite/bin/vite.js preview --config vite.config.ts",
        url: "http://127.0.0.1:4317/index.html",
        reuseExistingServer: !CI,
        timeout: 60_000,
    },
    projects: [
        { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
        { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 800 } } },
    ],
});

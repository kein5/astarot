import { defineConfig } from "vitest/config";
import { harnessModules } from "./src-ui/logics/test/harnessModules.ts";

// UI tests (src-ui). A config of its own keeps the app's Vite plugins (SVG, YAML, vanilla-extract)
// out of the test run: the tests read sources as text or load them through
// src-ui/logics/test/hookHarness.ts, and the rest run in plain Node.
export default defineConfig({
    // Sources that tests load with loadModule are built by Vite (src-ui/logics/test/harnessModules.ts),
    // so coverage and mutation testing see them.
    plugins: [harnessModules()],
    // JSX builds as the loaders built it before (Babel's automatic runtime): react/jsx-runtime,
    // without the development build's extra arguments.
    oxc: { jsx: { runtime: "automatic", development: false } },
    test: {
        // The i18n gate (tools/i18n_gate) checks the UI's text and the writing gate
        // (tools/writing_gate) the documents'; their own tests run here as well.
        include: ["src-ui/**/*.test.{js,mjs,ts}", "tools/i18n_gate/**/*.test.mjs", "tools/writing_gate/**/*.test.mjs"],
        environment: "node",
        setupFiles: ["src-ui/logics/test/vitestSetup.ts"],
        // Spies (vi.spyOn) go back to the real functions before each test, as node:test's
        // context.mock did after each one.
        restoreMocks: true,
        // Windows CI runners have taken well over Vitest's default 5 s to start a cold test.
        testTimeout: 30_000,
        hookTimeout: 30_000,
        coverage: {
            provider: "v8",
            include: ["src-ui/**/*.{js,jsx,ts,tsx}"],
            exclude: ["src-ui/**/*.test.*", "src-ui/logics/test/**", "src-ui/**/*.d.ts"],
            reporter: ["text-summary", "json-summary", "html"],
            reportsDirectory: "build/coverage/ui",
        },
    },
});

// Mutation testing for the UI (Issue #550). Run with `npm run test:mutation`; how to read and
// re-run the results is in docs/development.md ("UIのミューテーションテスト").
//
// mutator instruments sources in Vite's transform. Tests import the pure logic directly, and the
// sources they load with loadModule (src-ui/logics/test/hookHarness.ts: hooks, Tauri bridges and
// components) go through Vite too (src-ui/logics/test/harnessModules.ts), so every source the tests
// run can be mutated. Styles and the tests' own files are left out. A source that no test runs
// shows its mutants as NoCoverage: the score counts them, so it says what the tests leave
// untouched as well.
export default {
    runner: "vitest",
    vitestConfig: "vitest.mutator.config.js",
    include: ["src-ui/logics/**/*.{ts,tsx}", "src-ui/views/**/*.{ts,tsx}"],
    exclude: [
        "src-ui/**/*.test.*",
        "src-ui/**/*.d.ts",
        // Styles (vanilla-extract): class names and values, which the tests read as names.
        "src-ui/**/*.css.ts",
        // The tests' harness and data.
        "src-ui/logics/test/**",
        "src-ui/logics/_test_data.ts",
        // The component catalog (Storybook's stories, npm run dev:catalog): looked at, not tested.
        "src-ui/views/kit_catalog/**",
    ],
};

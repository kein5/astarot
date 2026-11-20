// Mutation testing for the UI (Issue #550). Run with `npm run test:mutation`; how to read and
// re-run the results is in docs/development.md ("UIのミューテーションテスト").
//
// mutator instruments sources through Vite. Only modules that the tests import go through Vite;
// sources that tests load with loadModule (src-ui/logics/test/hookHarness.ts) or
// loadBridgeRoutes (bridgeHarness.ts), or read as text, are evaluated outside Vite and get no
// mutants that any test can reach. They are excluded below so that the score covers what the
// tests can be measured on. Move a file out of `exclude` when its tests import it.
export default {
    runner: "vitest",
    vitestConfig: "vitest.mutator.config.js",
    include: [
        "src-ui/logics/**/*.ts",
        "src-ui/views/vr/vrPanelHover.ts",
    ],
    exclude: [
        "src-ui/**/*.test.*",
        "src-ui/**/*.d.ts",
        // Styles (vanilla-extract) and test data.
        "src-ui/**/*.css.ts",
        "src-ui/logics/test/**",
        "src-ui/logics/_test_data.ts",
        // React hooks: tests load them with loadModule.
        "src-ui/logics/**/use*.ts",
        // Tauri event bridges: tests load them with loadBridgeRoutes.
        "src-ui/logics/**/bridge.ts",
        // Loaded with loadModule by their tests.
        "src-ui/logics/common/closeBehavior.ts",
        // Read as text or through the components that use them.
        "src-ui/logics/common/vrPanelSend.ts",
        "src-ui/logics/voice/settingsNavigation.ts",
    ],
};

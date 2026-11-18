import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.js";

// Vitest config for mutation runs (mutator.config.json). Vitest 5 keeps transformed modules in
// node_modules/.vitest-cache (fsModuleCache, on by default) and does not tell mutator's
// instrumented transforms apart from earlier ones: with that cache in place, a run whose
// include differs from an earlier run reads modules without mutants, reports them as reached by
// no test and gives a score near 0% without any error. Mutation runs therefore skip the cache.
export default mergeConfig(base, defineConfig({
    test: {
        fsModuleCache: false,
    },
}));

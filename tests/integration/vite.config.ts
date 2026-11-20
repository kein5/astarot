// The app's own build (vite.config.js) with one page: the main window with Tauri's IPC replaced
// (app/index.html). Built into build/integration/ui and served by `vite preview` for the tests.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import type { UserConfig } from "vite";
import app from "../../vite.config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PORT = 4317;

export default defineConfig(async env => {
    const base: UserConfig = await (typeof app === "function" ? app(env) : app);
    return {
        ...base,
        root: path.resolve(here, "app"),
        build: {
            ...base.build,
            outDir: path.resolve(here, "../../build/integration/ui"),
            emptyOutDir: true,
            rollupOptions: { input: { main: path.resolve(here, "app/index.html") } },
        },
        preview: { host: "127.0.0.1", port: PORT, strictPort: true },
    };
});

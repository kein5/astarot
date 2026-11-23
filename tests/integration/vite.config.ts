// The app's own build (vite.config.js) with the main window, its Tauri IPC replaced
// (app/index.html), and two sample pages for the user guide's screenshots. Built into
// build/integration/ui and served by `vite preview` for the tests.
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
            // The other two pages draw the caption window and the VR panel's flow window from
            // sample data, for the user guide's screenshots (docsScreenshots.spec.ts).
            rollupOptions: { input: {
                main: path.resolve(here, "app/index.html"),
                caption_overlay: path.resolve(here, "app/caption-overlay.html"),
                vr_flow: path.resolve(here, "app/vr-flow.html"),
            } },
        },
        preview: { host: "127.0.0.1", port: PORT, strictPort: true },
    };
});

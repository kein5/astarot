import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import yaml from "@rollup/plugin-yaml";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(() => {
    return {
        // The page entries (index.html, vr.html, quick-chat.html, caption-overlay.html) live in src-ui;
        // the build still writes them to the root of dist for Tauri.
        root: path.resolve(__dirname, "src-ui"),
        plugins: [
            yaml({ include: ["**/*.yml", "**/*.yaml"] }),
            react(),
            svgr(),
            // Styles written in *.css.ts (ADR-010) become static CSS files at build time.
            vanillaExtractPlugin(),
        ],

        // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
        //
        // 1. prevent vite from obscuring rust errors
        clearScreen: false,
        // 2. tauri expects a fixed port, fail if that port is not available
        server: {
            port: 1420,
            strictPort: true,
            host: host || false,
            hmr: host
                ? {
                    protocol: "ws",
                    host,
                    port: 1421,
                }
                : undefined,
            watch: {
                // 3. keep backend files and large local datasets/environments out of the watcher.
                // Vite does not use .gitignore for watch exclusions.
                ignored: [
                    "**/src-tauri/**",
                    "**/tmp/**",
                    "**/.venv/**",
                    "**/.venv_cuda/**",
                    "**/.venv_linux/**",
                    "**/build/**",
                    "**/weights/**",
                ],
            },
        },

        build: {
            outDir: path.resolve(__dirname, "dist"),
            emptyOutDir: true,
            rollupOptions: {
                input: {
                    main: path.resolve(__dirname, "src-ui/index.html"),
                    vr: path.resolve(__dirname, "src-ui/vr.html"),
                    quick_chat: path.resolve(__dirname, "src-ui/quick-chat.html"),
                    caption_overlay: path.resolve(__dirname, "src-ui/caption-overlay.html"),
                    companion_panel: path.resolve(__dirname, "src-ui/companion-panel.html"),
                    companion_handle: path.resolve(__dirname, "src-ui/companion-handle.html"),
                },
            },
            sourcemap: true,
        },

        resolve: {
            alias: {
                "@root": path.resolve(__dirname),

                "@useI18n": path.resolve(__dirname, "locales/useI18n.js"),

                // Logic modules without an extension, so a file can move from .js to .ts
                // (ADR-010) without touching the alias; tsconfig.json has the same list.
                "@useReceiveRoutes": path.resolve(__dirname, "src-ui/logics/useReceiveRoutes"),
                "@useStdoutToPython": path.resolve(__dirname, "src-ui/logics/common/useStdoutToPython"),

                "@ui_configs": path.resolve(__dirname, "src-ui/logics/ui_configs"),
                "@scss_mixins": path.resolve(__dirname, "src-ui/views/common_css/mixins.scss"),
                "@store": path.resolve(__dirname, "src-ui/logics/store"),
                "@images": path.resolve(__dirname, "src-ui/views/assets"),
                "@utils": path.resolve(__dirname, "src-ui/logics/utils"),
                "@logics": path.resolve(__dirname, "src-ui/logics"),
                "@logics_common": path.resolve(__dirname, "src-ui/logics/common"),
                "@logics_main": path.resolve(__dirname, "src-ui/logics/main"),
                "@logics_configs": path.resolve(__dirname, "src-ui/logics/configs"),

                "@setting_box": path.resolve(__dirname, "src-ui/views/app/config_page/setting_section/setting_box/index"),
                "@common_components": path.resolve(__dirname, "src-ui/views/common_components/index"),
            },
        },

        css: {
            preprocessorOptions: {
                scss: {
                    api: "modern-compiler"
                }
            }
        }
    };
});

// Modules Vite turns into JavaScript that TypeScript cannot read by itself.
// vite/client (CSS Modules, images) and vite-plugin-svgr/client (*.svg?react) come from tsconfig.json.

declare module "*.yml" {
    const value: Record<string, unknown>;
    export default value;
}

// @babel/standalone ships no types. The test harness uses only transform, with the options below
// (harnessModules.ts also asks for the source map of the module transform).
declare module "@babel/standalone" {
    export type BabelPlugin = string | [string, Record<string, unknown>];
    export interface BabelOptions {
        presets?: BabelPlugin[];
        plugins?: BabelPlugin[];
        filename?: string;
        sourceType?: "module" | "script";
        sourceMaps?: boolean;
    }
    export interface BabelSourceMap {
        version: number;
        sources: string[];
        names: string[];
        mappings: string;
        sourcesContent?: string[];
        file?: string;
    }
    export function transform(source: string, options: BabelOptions): { code: string | null | undefined; map?: BabelSourceMap | null };
    const Babel: { transform: typeof transform };
    export default Babel;
}

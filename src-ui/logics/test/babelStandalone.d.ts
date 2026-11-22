// @babel/standalone ships no types. The test harness uses only transform, with the options below
// (harnessModules.ts also asks for the source map of the module transform, and adds a plugin of its own).
declare module "@babel/standalone" {
    import type { Node } from "@babel/types";
    // A node the visitor meets, and what it can do with it.
    export interface BabelPath {
        node: Node;
        replaceWith(node: Node): void;
    }
    // A plugin written in the harness: the visitor of the node types it changes.
    export interface BabelPluginObject {
        visitor: Record<string, (path: BabelPath) => void>;
    }
    export type BabelPlugin = string | [string, Record<string, unknown>] | (() => BabelPluginObject);
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

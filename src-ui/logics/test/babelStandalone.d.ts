// @babel/standalone ships no types. The test harness uses only transform, with the options below.
declare module "@babel/standalone" {
    export type BabelPlugin = string | [string, Record<string, unknown>];
    export interface BabelOptions {
        presets?: BabelPlugin[];
        plugins?: BabelPlugin[];
        filename?: string;
    }
    export function transform(source: string, options: BabelOptions): { code: string | null | undefined };
    const Babel: { transform: typeof transform };
    export default Babel;
}

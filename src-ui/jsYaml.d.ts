// js-yaml ships no types. The UI uses only load, which reads a YAML text into whatever it holds.
declare module "js-yaml" {
    export function load(text: string): unknown;
    const yaml: { load: typeof load };
    export default yaml;
}

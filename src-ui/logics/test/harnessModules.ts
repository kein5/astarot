import Babel from "@babel/standalone";
import type { BabelPluginObject } from "@babel/standalone";
import * as types from "@babel/types";
import type { Plugin } from "vite";

// The sources that tests load with loadModule (hookHarness.ts) go through Vite like any other
// module, so that coverage and mutation testing (mutator instruments sources in Vite's transform)
// reach them. A source imported with the query `?harness` is transformed as usual (TypeScript and
// JSX), then its imports and exports become CommonJS inside a function: the module's default
// export is that function, and loadModule calls it with the dependencies the test hands in, as it
// once called the same code built by `new Function`. Each call runs the source's top level again.
export const HARNESS_QUERY = "harness";

// import.meta.hot, Vite's hot module replacement, is one of the dependencies too: a test hands in its
// own to see what a module keeps across a replacement. Without one it is undefined, as in a build.
export const HOT_DEPENDENCY = "import.meta.hot";
const hotAsDependency = (): BabelPluginObject => ({
    visitor: {
        MemberExpression(path) {
            const node = path.node;
            if (!types.isMemberExpression(node) || node.computed) return;
            const { object, property } = node;
            if (types.isMetaProperty(object) && object.meta.name === "import" && object.property.name === "meta"
                && types.isIdentifier(property, { name: "hot" })) {
                path.replaceWith(types.callExpression(types.identifier("require"), [types.stringLiteral(HOT_DEPENDENCY)]));
            }
        },
    },
});

export function harnessModules(): Plugin {
    return {
        name: "astarot:harness-modules",
        enforce: "post",
        transform(code, id) {
            const [file, query = ""] = id.split("?");
            if (!new URLSearchParams(query).has(HARNESS_QUERY)) return null;
            const result = Babel.transform(code, {
                filename: file,
                sourceType: "module",
                sourceMaps: true,
                plugins: ["transform-modules-commonjs", hotAsDependency],
            });
            if (result.code === null || result.code === undefined) throw new Error(`${file}: no code after the module transform`);
            const map = result.map;
            // The wrapper adds one line above the code: the map starts a line later.
            return {
                code: `export default function (require, exports) {\n${result.code}\n}\n`,
                map: map ? { ...map, mappings: `;${map.mappings}` } : null,
            };
        },
    };
}

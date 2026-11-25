import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { parse } from "@babel/parser";
import { isNode } from "@babel/types";
import type { MemberExpression, Node, OptionalMemberExpression } from "@babel/types";

// Static only: no DOM, application startup, network, or execution of bundle code.
// @babel/parser and @babel/types are development dependencies of the same major version
// (package.json): the parser's tree is typed with the @babel/types this file names.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const config = JSON.parse(read("src-tauri/tauri.conf.json"));
const security = config.app.security;
// A CSP in Tauri v2's directive map: each directive's sources as a list or one text.
const sources = (policy: Record<string, string | string[]>, directive: string) => {
    assert.ok(policy && typeof policy === "object", "Use the Tauri v2 directive map");
    const value = policy[directive];
    assert.ok(value, `Missing ${directive}`);
    return Array.isArray(value) ? value : value.trim().split(/\s+/);
};
const hash = (css: string) => `'sha256-${createHash("sha256").update(css).digest("base64")}'`;
// Each library's stylesheet literal, recognised by how it starts. react-toastify 11.2 ships it
// formatted (":root {\n  --toastify-"); 11.0 minified it (":root{--toastify-").
const injectedStyles: [string, RegExp][] = [
    ["node_modules/react-colorful/dist/index.mjs", /^\.react-colorful\s*\{/],
    ["node_modules/react-toastify/dist/index.mjs", /^:root\s*\{\s*--toastify-/],
];
function files(directory: string): string[] {
    return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
        const name = `${directory}/${entry.name}`;
        return entry.isDirectory() ? files(name) : [name];
    });
}
// The walk meets Babel's nodes and the objects inside them; Babel tells which are nodes.
function walk(node: unknown, visit: (node: Node) => void) {
    if (!node || typeof node !== "object") return;
    if (isNode(node)) visit(node);
    for (const [key, value] of Object.entries(node)) {
        if (["loc", "comments", "tokens"].includes(key)) continue;
        if (Array.isArray(value)) value.forEach(child => { walk(child, visit); });
        else if (value && typeof value === "object") walk(value, visit);
    }
}
// TypeScript sources (ADR-010) are read with the same rules; .ts files have no JSX.
// isNode checks the parser's tree before the test walks it as a Node.
const ast = (code: string, file = ""): Node => {
    const tree: unknown = parse(code, { sourceType: "unambiguous", createImportExpressions: true,
        plugins: /\.ts$/.test(file) ? ["typescript"] : /\.tsx$/.test(file) ? ["typescript", "jsx"] : ["jsx"] });
    if (!isNode(tree)) throw new TypeError(`${file || "code"} did not parse into a syntax tree`);
    return tree;
};
// Like list.includes(value), for a value that may be anything.
const isOneOf = (list: readonly string[], value: unknown) => list.some(item => item === value);
const literal = (node: Node | null | undefined) => node?.type === "StringLiteral" ? node.value
    : node?.type === "TemplateLiteral" && !node.expressions.length ? node.quasis[0].value.cooked : null;
// A member's property is read by its name, as `property.name` did: a private name (#x) has none.
const member = (node: Node | null | undefined) => node?.type === "Identifier" ? node.name
    : node?.type === "MemberExpression" || node?.type === "OptionalMemberExpression"
        ? node.computed ? literal(node.property) : "name" in node.property ? node.property.name : undefined : null;
const remote = (value: string) => /^(?:[a-z][\w+.-]*:|\/\/)/i.test(value);
function cssProblems(css: string) {
    const problems: string[] = [];
    // Includes @font-face src, @import and CSS embedded in JSX string values.
    for (const match of css.matchAll(/(?:url\(\s*|@import\s+)["']?([^\s"')]+)/gi)) {
        if (remote(match[1]) && !match[1].startsWith("data:image/")) problems.push(`external CSS resource ${match[1]}`);
    }
    // CSS escapes can conceal a scheme; require an explicit review of such URLs.
    if (/(?:url\(|@import)[^;\n]*\\/i.test(css)) problems.push("escaped CSS resource URL");
    return problems;
}
// `Function.prototype.call`, `.apply` and `.bind` only borrow a method (js-base64 3.9 binds
// Uint8Array.prototype.toBase64 this way); they cannot make code from a string. Anything else on
// Function, including Function.prototype.constructor, is still reported.
const isStatic = (node: Node | null | undefined, name: string): node is MemberExpression | OptionalMemberExpression =>
    (node?.type === "MemberExpression" || node?.type === "OptionalMemberExpression")
    && !node.computed && "name" in node.property && node.property.name === name;
function borrowedFunctionMethods(tree: Node) {
    const names = new Set<Node>();
    walk(tree, node => {
        if ((isStatic(node, "call") || isStatic(node, "apply") || isStatic(node, "bind")) && isStatic(node.object, "prototype")
            && node.object.object.type === "Identifier" && node.object.object.name === "Function") names.add(node.object.object);
    });
    return names;
}
function jsProblems(code: string, application = true, file = "") {
    const problems: string[] = [];
    const tree = ast(code, file);
    const borrowed = borrowedFunctionMethods(tree);
    walk(tree, node => {
        const fail = (message: string) => problems.push(`${node.loc?.start.line}: ${message}`);
        // Check references too, so aliases and indirect eval cannot evade this guard.
        if ((node.type === "Identifier" && ["eval", "Function", "WebAssembly"].includes(node.name) && !borrowed.has(node))
            || ((node.type === "MemberExpression" || node.type === "OptionalMemberExpression")
                && isOneOf(["eval", "Function", "WebAssembly"], member(node)))) fail("dynamic code generation");
        if (node.type === "CallExpression" || node.type === "OptionalCallExpression" || node.type === "NewExpression") {
            const name = member(node.callee);
            if (isOneOf(["Worker", "SharedWorker"], name)) fail("worker requires a policy review");
            if (isOneOf(["setTimeout", "setInterval"], name) && literal(node.arguments[0]) !== null) fail("string timer");
            if (application) {
                if (isOneOf(["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "FontFace", "importScripts", "convertFileSrc", "createObjectURL", "toDataURL"], name)) fail(`new resource loader: ${name}`);
                if (name === "createElement" && isOneOf(["script", "style", "link", "iframe"], literal(node.arguments[0]))) fail("dynamic resource element");
                if (isOneOf(["insertAdjacentHTML", "write", "writeln"], name)
                    && member("object" in node.callee ? node.callee.object : undefined) === "document") fail("HTML injection");
                if (name === "setAttribute" && isOneOf(["src", "href", "style"], literal(node.arguments[0]))) fail("resource/style attribute setter");
            }
        }
        if ((node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration"
            || node.type === "ImportExpression") && node.source) {
            const value = literal(node.source);
            if (value === null || (value !== undefined && remote(value))) fail("non-local module import");
            if (application && value === "@tauri-apps/plugin-http") fail("HTTP plugin needs a separate native permission review");
        }
        const value = literal(node);
        if (value !== null && value !== undefined) problems.push(...cssProblems(value));
        if (!application) return;
        if (node.type === "AssignmentExpression" && isOneOf(["src", "href", "innerHTML", "outerHTML"], member(node.left))) fail("dynamic resource/HTML assignment");
        if (node.type === "JSXOpeningElement" && node.name.type === "JSXIdentifier"
            && isOneOf(["script", "style", "link", "iframe", "audio", "video"], node.name.name)) fail("new JSX resource element");
        if (node.type === "JSXAttribute") {
            if (node.name.name === "dangerouslySetInnerHTML") fail("HTML injection");
            const value = literal(node.value?.type === "JSXExpressionContainer" ? node.value.expression : node.value);
            if (isOneOf(["src", "srcSet"], node.name.name) && value && remote(value) && !value.startsWith("data:image/")) fail("external JSX resource");
        }
    });
    return problems;
}
function htmlProblems(html: string) {
    const problems: string[] = [];
    for (const tag of html.matchAll(/<(script|link|img|base|iframe|audio|video)\b[^>]*>/gi)) {
        for (const attribute of tag[0].matchAll(/(?:src|href)\s*=\s*["']([^"']*)["']/gi)) {
            if (remote(attribute[1])) problems.push(`external HTML resource ${attribute[1]}`);
        }
    }
    if (/<style\b|\sstyle\s*=|\son\w+\s*=|<script\b(?![^>]*\bsrc=)/i.test(html)) problems.push("inline HTML code/style");
    return problems;
}
function styleHashes(code: string) {
    const values: string[] = [];
    walk(ast(code), node => {
        const value = literal(node);
        if (value && injectedStyles.some(([, start]) => start.test(value))) values.push(hash(value));
    });
    return values;
}

test("production CSP allows only the reviewed resources and keeps Tauri CSP injection enabled", () => {
    const expected = {
        "default-src": ["'self'"], "script-src": ["'self'"], "style-src-attr": ["'none'"],
        "img-src": ["'self'", "data:"], "font-src": ["'self'"],
        "connect-src": ["'self'", "ipc:", "http://ipc.localhost", "https://ipc.localhost"],
        "media-src": ["'none'"], "worker-src": ["'none'"], "frame-src": ["'none'"],
        "object-src": ["'none'"], "base-uri": ["'self'"], "frame-ancestors": ["'none'"], "form-action": ["'none'"],
    };
    for (const [directive, allowed] of Object.entries(expected)) assert.deepEqual(sources(security.csp, directive), allowed, directive);
    assert.deepEqual(Object.keys(security.csp).sort(), [...Object.keys(expected), "style-src"].sort());
    assert.equal(security.dangerousDisableAssetCspModification ?? false, false);
    assert.equal(security.assetProtocol?.enable ?? false, false);
    for (const file of readdirSync(path.join(root, "src-tauri")).filter(name => /tauri\.[^/]+\.conf\.json$/.test(name)).map(name => `src-tauri/${name}`)) {
        assert.equal(JSON.parse(read(file)).app?.security, undefined, `${file} overrides the reviewed policy`);
    }
});

test("style hashes match the two installed runtime injectors, without unsafe-inline", () => {
    const hashes = injectedStyles.flatMap(([file]) => {
        const result = styleHashes(read(file));
        assert.equal(result.length, 1, `${file}: review the stylesheet injector after dependency changes`);
        return result;
    });
    assert.deepEqual(sources(security.csp, "style-src"), ["'self'", ...hashes]);
});

test("development relaxations are confined to Vite inline code/styles and loopback HMR", () => {
    assert.equal(config.build.devUrl, "http://localhost:1420");
    assert.deepEqual(sources(security.devCsp, "script-src"), ["'self'", "'unsafe-inline'"]);
    assert.deepEqual(sources(security.devCsp, "style-src"), ["'self'", "'unsafe-inline'"]);
    assert.deepEqual(sources(security.devCsp, "connect-src"), [
        ...sources(security.csp, "connect-src"), "ws://localhost:1420", "ws://127.0.0.1:1420", "ws://localhost:1421", "ws://127.0.0.1:1421",
    ]);
    for (const directive of Object.keys(security.csp)) {
        if (!["script-src", "style-src", "connect-src"].includes(directive)) assert.deepEqual(security.devCsp[directive], security.csp[directive]);
    }
});

test("production sources have no dynamic code or unreviewed resource loaders", () => {
    for (const file of [...files("src-ui"), ...files("locales")]) {
        if (/\.test\.[cm]?[jt]s$|\/test\/|\.d\.ts$/.test(file)) continue;
        if (!/\.(?:[cm]?jsx?|tsx?|css|scss|html|svg)$/.test(file)) continue;
        const code = read(file);
        const problems = /\.(?:[cm]?jsx?|tsx?)$/.test(file) ? jsProblems(code, true, file)
            : /\.(?:css|scss)$/.test(file) ? cssProblems(code)
                : /\.(?:html|svg)$/.test(file) ? htmlProblems(code) : [];
        assert.deepEqual(problems, [], `${file}: update the CSP inventory and policy before adding resources`);
    }
});

// A modal Radix Popover locks the page's scrolling with a <style> made at run time, which the
// policy does not allow (no unsafe-inline): the app's popovers are never modal (kit/Popover.tsx).
test("no popover of the app is modal", () => {
    for (const file of files("src-ui").filter(name => /\.tsx$/.test(name) && !/\.test\./.test(name))) {
        // The element's props run to its first ">" that does not end an arrow function.
        assert.doesNotMatch(read(file), /<(?:RadixPopover\.Root|Popover)\b(?:=>|[^>])*\bmodal\b/, file);
    }
});

test("guards detect direct, indirect and computed eval and remote script/style/font loading", () => {
    for (const code of ["eval('x')", "(0, eval)('x')", "const run = window['eval']; run('x')", "new Function('x')", "Function('x')", "new globalThis['Function']('x')", "WebAssembly.compile(bytes)", "setTimeout('x', 1)", "import('https://cdn.invalid/a.js')", "const s = document.createElement('script')", "element.src = url", "const x = <script src={url} />", "const x = <img src='https://cdn.invalid/a.png' />", "new FontFace('remote', url)", "fetch(url)"]) {
        assert.notEqual(jsProblems(code).length, 0, code);
    }
    for (const css of ["@import 'https://cdn.invalid/a.css';", "@font-face{src:url(https://cdn.invalid/a.woff2)}", "body{background:url(//cdn.invalid/a.svg)}"]) assert.notEqual(cssProblems(css).length, 0, css);
    assert.notEqual(htmlProblems('<link rel="stylesheet" href="https://cdn.invalid/a.css">').length, 0);
    assert.deepEqual(jsProblems('const help = "https://example.invalid"; element.style.setProperty("color", "red");'), []);
    assert.notEqual(jsProblems("const run = (code: string): unknown => eval(code);", true, "a.ts").length, 0);
    for (const code of ["Function.prototype.constructor('x')", "const F = Function.prototype.constructor; F('x')",
        "Function.prototype['call'].bind(Function)", "Function.prototype.call.call(Function, null, 'x')"]) {
        assert.notEqual(jsProblems(code).length, 0, code);
    }
    assert.deepEqual(jsProblems("const encode = Function.prototype.call.bind(Uint8Array.prototype.toBase64);"), []);
    assert.notEqual(jsProblems("const x = <script src={url as string} />;", true, "a.tsx").length, 0);
});

test("emitted production dependencies and HTML agree with the policy (run after vite-build)", context => {
    if (!existsSync(path.join(root, "dist/index.html"))) {
        context.skip("No dist: run npm run vite-build, then run this test again for the bundle check");
        return;
    }
    const built = files("dist");
    assert.deepEqual(built.filter(file => file.endsWith(".html")).sort(), ["dist/caption-overlay.html",
        "dist/companion-handle.html", "dist/companion-panel.html", "dist/index.html", "dist/quick-chat.html", "dist/vr.html"]);
    const hashes: string[] = [];
    let styleInjectors = 0, precedenceStyles = 0, scrollLockStyles = 0;
    for (const file of built) {
        if (file.endsWith(".js")) {
            const code = read(file);
            assert.deepEqual(jsProblems(code, false), [], file);
            hashes.push(...styleHashes(code));
            walk(ast(code), node => {
                if (node.type !== "CallExpression" || member(node.callee) !== "createElement" || literal(node.arguments[0]) !== "style") return;
                // react-dom 19 makes a <style> for a <style href precedence> that a component draws
                // (its hoistable resources). The app's sources draw no <style> ("new JSX resource
                // element" above), so it does not run; it carries no stylesheet to hash.
                const start = node.start ?? 0;
                if (code.slice(Math.max(0, start - 300), start).includes("data-precedence")) precedenceStyles++;
                // react-style-singleton makes the <style> with which react-remove-scroll locks the
                // page's scrolling (it reads get-nonce's __webpack_nonce__ just before). Radix's
                // Popover draws it only when modal, and the kit's Popover is never modal (below),
                // so it does not run; its stylesheet is made at run time and has no hash to allow.
                else if (code.slice(Math.max(0, start - 300), start).includes("__webpack_nonce__")
                    && /^document\.createElement\(.style.\);\w+\.type=.text\/css.;/.test(code.slice(start))) scrollLockStyles++;
                else styleInjectors++;
            });
        } else if (file.endsWith(".css")) assert.deepEqual(cssProblems(read(file)), [], file);
        else if (file.endsWith(".html")) assert.deepEqual(htmlProblems(read(file)), [], file);
        assert.ok(!/\.(?:wasm|woff2?|ttf|otf|mp[34]|wav|ogg|webm)$/.test(file), `${file}: new resource class needs review`);
    }
    assert.equal(styleInjectors, injectedStyles.length, "Review new or changed runtime style injectors");
    assert.equal(precedenceStyles, 1, "Review react-dom's <style precedence> resource after a react-dom change");
    assert.ok(scrollLockStyles <= 1, "Review react-remove-scroll's style singleton after a Radix change");
    assert.deepEqual(hashes.sort(), sources(security.csp, "style-src").filter(value => value !== "'self'").sort());
});

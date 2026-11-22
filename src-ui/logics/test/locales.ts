// The UI's locale files (locales/*.yml), read by the tests that compare texts with them. A locale
// file is a mapping whose values are texts or further mappings; readLocale checks that, so the
// tests read the files with their real shape and no declaration.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

export type LocaleTree = string | LocaleBranch;
export interface LocaleBranch {
    readonly [key: string]: LocaleTree;
}

const isTree = (value: unknown): value is LocaleTree => typeof value === "string" || isBranch(value);
function isBranch(value: unknown): value is LocaleBranch {
    return typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every(isTree);
}

export function readLocale(language: string): LocaleBranch {
    const name = `locales/${language}.yml`;
    const tree: unknown = yaml.load(readFileSync(new URL(`../../../${name}`, import.meta.url), "utf8"));
    if (!isBranch(tree)) throw new TypeError(`${name} is not a mapping of texts`);
    return tree;
}

// What is at the dotted path ("config_page.ocr.title"), or undefined where a level is missing or is
// a text with more of the path left.
export function localeAt(tree: LocaleTree, path: string): LocaleTree | undefined {
    let node: LocaleTree | undefined = tree;
    for (const key of path.split(".")) {
        if (node === undefined || typeof node === "string") return undefined;
        node = node[key];
    }
    return node;
}

// The text at the path, or the test fails there.
export function textAt(tree: LocaleTree, path: string): string {
    const text = localeAt(tree, path);
    assert.equal(typeof text, "string", `no text at ${path}`);
    return typeof text === "string" ? text : "";
}

// The mapping at the path, or the test fails there.
export function branchAt(tree: LocaleTree, path: string): LocaleBranch {
    const branch = localeAt(tree, path);
    assert.ok(branch !== undefined && typeof branch !== "string", `no mapping at ${path}`);
    return branch;
}

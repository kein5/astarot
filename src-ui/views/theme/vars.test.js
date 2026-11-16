import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The vanilla-extract contract names custom properties that variables.css defines; a typo or a
// removed token would otherwise become an empty var() in the built CSS.
const read = name => readFileSync(new URL(name, import.meta.url), "utf8");

test("every token in the vanilla-extract contract is defined in variables.css", () => {
    const contract = read("./vars.css.ts");
    const list = contract.slice(contract.indexOf("const NAMES = ["), contract.indexOf("] as const"));
    const names = [...list.matchAll(/"([a-z0-9_]+)"/g)].map(match => match[1]);
    assert.ok(names.length > 50, `found ${names.length} names: the contract no longer matches this test`);
    const defined = new Set([...read("../app/_index_css/variables.css").matchAll(/--([a-z0-9_]+)\s*:/g)].map(match => match[1]));
    assert.deepEqual(names.filter(name => !defined.has(name)), []);
    assert.equal(new Set(names).size, names.length, "a token is listed twice");
});

import assert from "node:assert/strict";

// The text of one style in a .css.ts source (#957): from `export const <name> = style(` to its
// closing parenthesis, so a test can look for a declaration in that style only, as the tests of
// the SCSS modules looked in one rule.
export const styleOf = (source: string, name: string): string => {
    const start = source.indexOf(`export const ${name} = style(`);
    assert.ok(start >= 0, `${name} is a style`);
    let depth = 0;
    for (let at = source.indexOf("(", start); at < source.length; at++) {
        if (source[at] === "(") depth++;
        else if (source[at] === ")" && --depth === 0) return source.slice(start, at + 1);
    }
    return assert.fail(`${name} is not closed`);
};

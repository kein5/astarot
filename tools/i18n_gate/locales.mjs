// Checks on the locale files themselves: the same keys in every language, no empty text,
// the same interpolation variables, plural forms each language needs, and $t() nesting that
// points at a key that exists. en and ja are the reference languages (locales/*.yml).
import yaml from "js-yaml";

export const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

// Flattens the YAML tree into "a.b.c" -> value. Arrays keep their index as a segment, so
// lists of lines (returnObjects) are compared item by item.
export const flatten = (tree, prefix = "", out = new Map()) => {
    if (Array.isArray(tree)) {
        tree.forEach((item, index) => {
            flatten(item, `${prefix}.${index}`, out);
        });
    } else if (tree !== null && typeof tree === "object") {
        for (const [key, value] of Object.entries(tree)) {
            flatten(value, prefix ? `${prefix}.${key}` : key, out);
        }
    } else {
        out.set(prefix, tree);
    }
    return out;
};

// Every key that names a subtree ("a", "a.b" for "a.b.c"), so a template key such as
// t(`main_page.${id}`) can be checked against its fixed part.
export const branchesOf = (keys) => {
    const branches = new Set();
    for (const key of keys) {
        const parts = key.split(".");
        for (let i = 1; i < parts.length; i++) branches.add(parts.slice(0, i).join("."));
    }
    return branches;
};

export const parseLocale = (source, language) => {
    let tree;
    try {
        tree = yaml.load(source);
    } catch (error) {
        throw new Error(`locales/${language}.yml: YAML error: ${error.message}`);
    }
    if (tree === null || typeof tree !== "object" || Array.isArray(tree)) {
        throw new Error(`locales/${language}.yml: the top level must be a mapping`);
    }
    return { language, tree, flat: flatten(tree) };
};

// {{name}} and {{name, format}}; - prefixed names are i18next's unescaped form.
export const variablesOf = (text) => {
    const names = new Set();
    for (const match of String(text).matchAll(/\{\{\s*-?\s*([^},\s]+)[^}]*\}\}/g)) names.add(match[1]);
    return names;
};

export const nestedKeysOf = (text) => {
    const keys = [];
    for (const match of String(text).matchAll(/\$t\(\s*([^,)\s]+)/g)) keys.push(match[1].replace(/^["']|["']$/g, ""));
    return keys;
};

const sorted = (set) => [...set].sort();

// A key in a plural group: it ends in a CLDR category and some form of the group counts.
const pluralGroups = (flat) => {
    const groups = new Map();
    for (const [key, value] of flat) {
        const match = key.match(PLURAL_SUFFIX);
        if (!match) continue;
        const base = key.slice(0, -match[0].length);
        if (!groups.has(base)) groups.set(base, new Map());
        groups.get(base).set(match[1], value);
    }
    for (const [base, forms] of groups) {
        const counts = [...forms.values()].some((value) => variablesOf(value).has("count"));
        if (!counts) groups.delete(base);
    }
    return groups;
};

export const pluralCategories = (language) => new Intl.PluralRules(language).resolvedOptions().pluralCategories;

// Returns a list of { file, key, message } problems; an empty list means the locales agree.
export const checkLocales = (locales) => {
    const problems = [];
    const add = (language, key, message) => problems.push({ file: `locales/${language}.yml`, key, message });
    const [reference, ...others] = locales;

    for (const locale of locales) {
        for (const [key, value] of locale.flat) {
            if (typeof value !== "string") {
                add(locale.language, key, `value is ${value === null ? "empty (null)" : typeof value}; expected text`);
            } else if (value === "") {
                // Whitespace alone is allowed: separators such as ja's full-width space.
                add(locale.language, key, "value is empty");
            }
        }
    }

    for (const other of others) {
        for (const key of reference.flat.keys()) {
            if (!other.flat.has(key)) add(other.language, key, `missing; locales/${reference.language}.yml has it`);
        }
        for (const key of other.flat.keys()) {
            if (!reference.flat.has(key))
                add(other.language, key, `not in locales/${reference.language}.yml (extra key)`);
        }
        for (const [key, value] of reference.flat) {
            if (!other.flat.has(key) || typeof value !== "string") continue;
            const expected = variablesOf(value);
            const actual = variablesOf(other.flat.get(key));
            const missing = sorted([...expected].filter((name) => !actual.has(name)));
            const extra = sorted([...actual].filter((name) => !expected.has(name)));
            if (missing.length || extra.length) {
                const parts = [];
                if (missing.length) parts.push(`missing {{${missing.join("}}, {{")}}}`);
                if (extra.length) parts.push(`unknown {{${extra.join("}}, {{")}}}`);
                add(other.language, key, `interpolation differs from ${reference.language}: ${parts.join("; ")}`);
            }
        }
    }

    for (const locale of locales) {
        const needed = pluralCategories(locale.language);
        for (const [base, forms] of pluralGroups(locale.flat)) {
            const absent = needed.filter((category) => !forms.has(category));
            if (absent.length)
                add(locale.language, base, `plural forms missing: ${absent.map((c) => `${base}_${c}`).join(", ")}`);
        }
        const leaves = new Set(locale.flat.keys());
        const plurals = new Set(pluralGroups(locale.flat).keys());
        for (const [key, value] of locale.flat) {
            for (const nested of nestedKeysOf(value)) {
                if (!leaves.has(nested) && !plurals.has(nested))
                    add(locale.language, key, `$t(${nested}) points at no key`);
            }
        }
    }
    return problems;
};

// What the source scan resolves keys against: leaves, plural bases and subtrees of the
// reference language (the others are held to the same keys by checkLocales).
export const keyIndex = (locale) => {
    const leaves = new Set(locale.flat.keys());
    const plurals = new Set(pluralGroups(locale.flat).keys());
    const branches = branchesOf(leaves);
    const namespaces = new Set(Object.keys(locale.tree));
    return { leaves, plurals, branches, namespaces };
};

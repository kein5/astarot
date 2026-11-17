#!/usr/bin/env node
// i18n quality gate (Issue #515). Run from the repository root:
//
//   node tools/i18n_gate/check.mjs                    check; exit 1 on any problem
//   node tools/i18n_gate/check.mjs --update-baseline  rewrite the baseline of known hard-coded text
//   node tools/i18n_gate/check.mjs --inventory        count the known hard-coded text by area
//
// It checks that locales/en.yml and locales/ja.yml have the same keys, no empty text, the
// same {{variables}} and the plural forms each language needs; that every key the UI names
// exists; and that the UI does not gain new text written straight into the code. Text that
// was already hard-coded is listed in baseline.json and may only shrink.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { checkLocales, keyIndex, parseLocale } from "./locales.mjs";
import { makeNeedsTranslation, scanSource } from "./source.mjs";
import { compareBaseline, countFindings } from "./baseline.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const LANGUAGES = ["en", "ja"];
const SOURCE_ROOT = "src-ui";
const SOURCE_FILE = /\.(jsx?|tsx?)$/;
const SKIPPED_FILE = /\.(test|spec)\.[jt]sx?$|\.d\.ts$/;

const toPosix = (path) => path.split(sep).join("/");

export const loadExceptions = (text) => {
    const data = yaml.load(text) ?? {};
    const problems = [];
    const terms = [];
    const paths = [];
    for (const entry of data.terms ?? []) {
        if (!entry?.text || !entry?.reason) problems.push(`exceptions.yml: every term needs text and reason (${JSON.stringify(entry)})`);
        else terms.push(String(entry.text));
    }
    for (const entry of data.paths ?? []) {
        if (!entry?.path || !entry?.reason) problems.push(`exceptions.yml: every path needs path and reason (${JSON.stringify(entry)})`);
        else paths.push(String(entry.path));
    }
    return { terms, paths, problems };
};

// A path entry is a file, or a folder when it ends with "/".
const isExceptedPath = (file, paths) => paths.some(path => path.endsWith("/") ? file.startsWith(path) : file === path);

const listSources = (root, paths) => {
    const files = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "node_modules") walk(full);
            } else if (SOURCE_FILE.test(entry.name) && !SKIPPED_FILE.test(entry.name)) {
                const file = toPosix(relative(root, full));
                if (!isExceptedPath(file, paths)) files.push(file);
            }
        }
    };
    walk(join(root, SOURCE_ROOT));
    return files.sort();
};

export const runGate = (root) => {
    const errors = [];
    const locales = LANGUAGES.map(language => parseLocale(readFileSync(join(root, "locales", `${language}.yml`), "utf8"), language));
    for (const problem of checkLocales(locales)) {
        errors.push({ file: problem.file, line: lineOfKey(root, problem.file, problem.key), column: 1,
            message: `${problem.key}: ${problem.message}` });
    }

    const exceptions = loadExceptions(readFileSync(join(HERE, "exceptions.yml"), "utf8"));
    for (const problem of exceptions.problems) errors.push({ file: "tools/i18n_gate/exceptions.yml", line: 1, column: 1, message: problem });

    const index = keyIndex(locales[0]);
    const needsTranslation = makeNeedsTranslation(exceptions.terms);
    const hardcoded = [];
    const files = listSources(root, exceptions.paths);
    for (const file of files) {
        const result = scanSource(file, readFileSync(join(root, file), "utf8"), { index, needsTranslation });
        errors.push(...result.errors, ...result.keys.map(item => ({ ...item, message: `translation key ${item.message}` })));
        hardcoded.push(...result.hardcoded);
    }
    return { errors, hardcoded, files };
};

// Locale problems name a key; point at the line that defines it (or its nearest parent).
const lineCache = new Map();
const lineOfKey = (root, file, key) => {
    if (!lineCache.has(file)) lineCache.set(file, readFileSync(join(root, file), "utf8").split(/\r?\n/));
    return findKeyLine(lineCache.get(file), key);
};

// The 1-based line of a YAML key ("a.b.c"), or of the deepest parent found.
export const findKeyLine = (lines, key) => {
    const parts = key.split(".");
    let line = 0;
    let depth = -1;
    for (const part of parts) {
        if (/^\d+$/.test(part)) break;
        let found = false;
        for (let i = depth < 0 ? 0 : line + 1; i < lines.length; i++) {
            const match = lines[i].match(/^(\s*)([^\s:#][^:]*):/);
            if (!match) continue;
            const indent = match[1].length;
            if (indent <= depth) break;
            if (match[2].replace(/^["']|["']$/g, "") === part) {
                line = i;
                depth = indent;
                found = true;
                break;
            }
        }
        if (!found) break;
    }
    return line + 1;
};

const annotate = (level, item) => {
    const where = `${item.file}:${item.line}:${item.column}`;
    console.log(`${where}: ${item.message}`);
    if (process.env.GITHUB_ACTIONS === "true") {
        const message = item.message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
        console.log(`::${level} file=${item.file},line=${item.line},col=${item.column}::${message}`);
    }
};

const inventory = (counts) => {
    const byArea = new Map();
    const byKind = new Map();
    let total = 0;
    for (const [file, entries] of Object.entries(counts)) {
        const area = file.split("/").slice(0, 4).join("/");
        for (const [entry, count] of Object.entries(entries)) {
            const kind = entry.slice(0, entry.indexOf("|"));
            byArea.set(area, (byArea.get(area) ?? 0) + count);
            byKind.set(kind, (byKind.get(kind) ?? 0) + count);
            total += count;
        }
    }
    const rows = (map) => [...map].sort((a, b) => b[1] - a[1]).map(([name, count]) => `  ${String(count).padStart(5)}  ${name}`).join("\n");
    return `Known hard-coded text: ${total} in ${Object.keys(counts).length} files\n\nBy kind:\n${rows(byKind)}\n\nBy area:\n${rows(byArea)}`;
};

const main = () => {
    const root = process.cwd();
    const args = new Set(process.argv.slice(2));
    const unknown = [...args].filter(arg => !["--update-baseline", "--inventory"].includes(arg));
    if (unknown.length || !existsSync(join(root, "locales", "en.yml"))) {
        console.error(unknown.length ? `Unknown option: ${unknown.join(" ")}` : "Run from the repository root (locales/en.yml not found).");
        process.exit(2);
    }
    const baselinePath = join(HERE, "baseline.json");
    const { errors, hardcoded, files } = runGate(root);
    const counts = countFindings(hardcoded);

    if (args.has("--update-baseline")) {
        writeFileSync(baselinePath, `${JSON.stringify(counts, null, 2)}\n`);
        console.log(`Wrote tools/i18n_gate/baseline.json.\n${inventory(counts)}`);
    } else if (args.has("--inventory")) {
        console.log(inventory(counts));
    }

    const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};
    const { added, fixed } = args.has("--update-baseline") ? { added: [], fixed: [] } : compareBaseline(hardcoded, baseline);

    for (const item of errors) annotate("error", item);
    for (const item of added) {
        annotate("error", { ...item, message: `hard-coded ${item.kind === "jsx-text" ? "text" : item.kind.replace(":", " ")} "${item.text}": `
            + "move it to locales/en.yml and locales/ja.yml and use t(), or mark it // i18n-exempt: <reason>" });
    }
    for (const item of fixed) {
        annotate("error", { file: item.file, line: 1, column: 1,
            message: `${item.count} fewer hard-coded "${item.text}" than tools/i18n_gate/baseline.json lists; `
                + "run node tools/i18n_gate/check.mjs --update-baseline so it cannot come back" });
    }
    const problems = errors.length + added.length + fixed.length;
    console.log(`i18n gate: ${files.length} source files, ${LANGUAGES.join("/")} locales; `
        + `${problems ? `${problems} problem(s)` : "no problems"} (known hard-coded text: ${hardcoded.length}).`);
    process.exit(problems ? 1 : 0);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

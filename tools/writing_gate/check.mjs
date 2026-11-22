#!/usr/bin/env node
// Writing gate: the rules of docs/writing/ that a pattern can check. Run from the repository
// root:
//
//   node tools/writing_gate/check.mjs                    check; exit 1 on a new finding
//   node tools/writing_gate/check.mjs --inventory        count the findings by rule and area
//   node tools/writing_gate/check.mjs --update-baseline  rewrite the baseline after fixing text
//   node tools/writing_gate/check.mjs --file body.md     check one file outside the documents
//                                                       (a pull request body, a report);
//                                                       --user reads it as user-facing text
//
// It reads the documents git tracks (Markdown, the user guide's .mdx and locales/*.yml), leaves
// out what exceptions.yml names, and reports the findings that baseline.json does not hold.
// The baseline is the findings that were in the documents when the gate came in; a count may
// only go down. The judgement calls of the guidelines are not checked here: the checklists at
// the end of each guideline stay with the writer.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { compareBaseline, countFindings } from "../i18n_gate/baseline.mjs";
import { localeProse, markdownProse } from "./prose.mjs";
import { EMOJI_RULE, LINE_RULES, ORDER_RULE, languageOf } from "./rules.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOCUMENT = /\.(md|mdx)$/;
const LOCALE = /^locales\/[a-z]+\.yml$/;
// User-facing text (the "user" rules apply): the user guide, the README files for users,
// the release notes and the UI strings.
const USER_FACING = [/^site\//, /^docs\/readmes\//, /^docs\/release-notes\/(?!README\.md$)/, LOCALE];

export const loadExceptions = (text) => {
    const data = yaml.load(text) ?? {};
    const problems = [];
    const paths = [];
    for (const entry of data.paths ?? []) {
        if (!entry?.path || !entry?.reason)
            problems.push(`exceptions.yml: every path needs path and reason (${JSON.stringify(entry)})`);
        else paths.push(String(entry.path));
    }
    return { paths, problems };
};

const isExceptedPath = (file, paths) =>
    paths.some((path) => (path.endsWith("/") ? file.startsWith(path) : file === path));

export const audienceOf = (file) => (USER_FACING.some((pattern) => pattern.test(file)) ? "user" : "dev");

export const listDocuments = (root, paths) =>
    execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
        .split("\0")
        .filter((file) => file && (DOCUMENT.test(file) || LOCALE.test(file)) && !isExceptedPath(file, paths))
        .sort();

// The findings of one document: { file, line, column, kind (the rule), text, message }.
export const scanDocument = (file, source, { audience = audienceOf(file) } = {}) => {
    const { prose, problems } = LOCALE.test(file)
        ? localeProse(source)
        : markdownProse(source, { mdx: file.endsWith(".mdx") });
    const findings = [];
    const errors = problems.map((problem) => ({ file, line: problem.line, column: 1, message: problem.message }));
    const add = (rule, line, match) =>
        findings.push({
            file,
            line: line.line,
            column: match.index + 1,
            kind: rule.id,
            text: match[0].trim(),
            message: rule.message,
        });
    const releaseNotes = /^docs\/release-notes\//.test(file);
    for (const line of prose) {
        const language = languageOf(line.text);
        for (const rule of LINE_RULES) {
            if (rule.lang !== language) continue;
            if (rule.audience === "user" && audience !== "user") continue;
            if (rule.audience === "documents" && LOCALE.test(file)) continue;
            for (const match of line.text.matchAll(rule.pattern)) add(rule, line, match);
        }
        if (line.heading) for (const match of line.text.matchAll(ORDER_RULE.pattern)) add(ORDER_RULE, line, match);
        if (!releaseNotes) for (const match of line.text.matchAll(EMOJI_RULE.pattern)) add(EMOJI_RULE, line, match);
    }
    return { findings, errors };
};

export const runGate = (root) => {
    const exceptions = loadExceptions(readFileSync(join(HERE, "exceptions.yml"), "utf8"));
    const errors = exceptions.problems.map((message) => ({
        file: "tools/writing_gate/exceptions.yml",
        line: 1,
        column: 1,
        message,
    }));
    const findings = [];
    const files = listDocuments(root, exceptions.paths);
    for (const file of files) {
        const result = scanDocument(file, readFileSync(join(root, file), "utf8"));
        errors.push(...result.errors);
        findings.push(...result.findings);
    }
    return { errors, findings, files };
};

const annotate = (level, item) => {
    console.log(`${item.file}:${item.line}:${item.column}: ${item.message}${item.text ? ` [${item.text}]` : ""}`);
    if (process.env.GITHUB_ACTIONS === "true") {
        const message = item.message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
        console.log(`::${level} file=${item.file},line=${item.line},col=${item.column}::${message}`);
    }
};

// Counts by rule and by area (the first one or two folders), for the inventory.
export const inventory = (findings) => {
    const byRule = {};
    const byArea = {};
    for (const item of findings) {
        byRule[item.kind] = (byRule[item.kind] ?? 0) + 1;
        const parts = item.file.split("/");
        const area =
            parts.length > 2 && ["docs", "site"].includes(parts[0])
                ? `${parts[0]}/${parts[1]}`
                : parts.length > 1
                  ? parts[0]
                  : item.file;
        byArea[area] = (byArea[area] ?? 0) + 1;
    }
    return { byRule, byArea };
};

const main = (argv) => {
    const root = process.cwd();
    const fileAt = argv.indexOf("--file");
    if (fileAt >= 0) {
        const path = argv[fileAt + 1];
        if (!path || !existsSync(path)) {
            console.error("--file needs a file to read");
            return 2;
        }
        const { findings, errors } = scanDocument(path, readFileSync(path, "utf8"), {
            audience: argv.includes("--user") ? "user" : "dev",
        });
        for (const item of [...errors, ...findings]) annotate("error", item);
        console.log(
            findings.length + errors.length
                ? `writing gate: ${findings.length + errors.length} finding(s) in ${path}`
                : `writing gate: ${path} passed`,
        );
        return findings.length + errors.length ? 1 : 0;
    }
    const baselinePath = join(HERE, "baseline.json");
    const { errors, findings, files } = runGate(root);
    if (argv.includes("--inventory")) {
        const { byRule, byArea } = inventory(findings);
        const sorted = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1]);
        console.log(`${files.length} documents, ${findings.length} findings`);
        console.log("by rule:");
        for (const [rule, count] of sorted(byRule)) console.log(`  ${String(count).padStart(5)}  ${rule}`);
        console.log("by area:");
        for (const [area, count] of sorted(byArea)) console.log(`  ${String(count).padStart(5)}  ${area}`);
        return 0;
    }
    if (argv.includes("--update-baseline")) {
        writeFileSync(baselinePath, `${JSON.stringify(countFindings(findings), null, 2)}\n`);
        console.log(`writing gate: baseline rewritten with ${findings.length} findings in ${files.length} documents`);
        return errors.length ? 1 : 0;
    }
    const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};
    const { added, fixed } = compareBaseline(findings, baseline);
    for (const item of errors) annotate("error", item);
    for (const item of added) annotate("error", item);
    for (const item of fixed)
        annotate("error", {
            file: item.file,
            line: 1,
            column: 1,
            message: `fixed ${item.count} × ${item.kind} [${item.text}]: run --update-baseline so it cannot come back`,
        });
    const failed = errors.length + added.length + fixed.length;
    console.log(
        failed
            ? `writing gate: ${failed} problem(s) in ${files.length} documents`
            : `writing gate: ${files.length} documents passed`,
    );
    return failed ? 1 : 0;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
    process.exitCode = main(process.argv.slice(2));

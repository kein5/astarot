// Checks the ASTAROT manual in the built guide (site/.vitepress/theme/manual/content.mjs): both
// languages carry the same words, every chapter has its page, every guide page a chapter links is
// built in Japanese and in English, and every picture the manual shows is there.
//
//   node tools/check_site_manual.mjs site/.vitepress/dist
//
// Exits 1 and names what is missing.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(process.argv[2] ?? join(root, "site/.vitepress/dist"));
const { CALLOUTS, CHAPTERS, FACES, FEATURES, WORDS } = await import(
    pathToFileURL(join(root, "site/.vitepress/theme/manual/content.mjs"))
);

const failures = [];

// The same keys, and the same kind of value, in both languages.
function compare(ja, en, path) {
    if (typeof ja !== typeof en || Array.isArray(ja) !== Array.isArray(en)) {
        failures.push(`${path}: Japanese is ${Array.isArray(ja) ? "a list" : typeof ja}, English is ${Array.isArray(en) ? "a list" : typeof en}`);
        return;
    }
    if (Array.isArray(ja)) {
        // Paragraphs may differ in number; lists of objects (steps, rows) must not.
        if (ja.some(item => typeof item === "object") && ja.length !== en.length) failures.push(`${path}: ${ja.length} items in Japanese, ${en.length} in English`);
        ja.forEach((item, index) => typeof item === "object" && compare(item, en[index], `${path}[${index}]`));
        return;
    }
    if (ja && typeof ja === "object") {
        for (const key of new Set([...Object.keys(ja), ...Object.keys(en)])) {
            if (!(key in ja)) failures.push(`${path}.${key}: missing in Japanese`);
            else if (!(key in en)) failures.push(`${path}.${key}: missing in English`);
            else compare(ja[key], en[key], `${path}.${key}`);
        }
        return;
    }
    if (typeof ja === "string" && (!ja.trim() || !en.trim())) failures.push(`${path}: empty`);
}
compare(WORDS.ja, WORDS.en, "WORDS");

// The words every chapter, face, callout and feature needs.
for (const locale of ["ja", "en"]) {
    const words = WORDS[locale];
    for (const face of FACES) if (!words.guide.faces[face]) failures.push(`${locale}: no words for the face ${face}`);
    for (const { kind } of CALLOUTS) if (!words.guide.callouts[kind]) failures.push(`${locale}: no words for the callout ${kind}`);
    for (const { id } of FEATURES) if (!words.features.items[id]) failures.push(`${locale}: no words for the feature ${id}`);
    for (const chapter of CHAPTERS) {
        if (!chapter.title[locale] || !chapter.summary[locale]) failures.push(`${locale}: chapter ${chapter.slug} has no title or summary`);
        for (const page of chapter.guide) if (!page.label[locale]) failures.push(`${locale}: chapter ${chapter.slug} links ${page.path} without a label`);
    }
}

const slugs = new Set(CHAPTERS.map(chapter => chapter.slug));
if (CHAPTERS.length !== 10) failures.push(`${CHAPTERS.length} chapters, the contents promise 10`);
if (slugs.size !== CHAPTERS.length) failures.push("two chapters share a slug");
for (const { chapters } of FEATURES) for (const slug of chapters) if (!slugs.has(slug)) failures.push(`a feature links the missing chapter ${slug}`);
for (const step of [...WORDS.ja.quickstart.steps, ...WORDS.en.quickstart.steps]) {
    if (!slugs.has(step.chapter)) failures.push(`a quick start step links the missing chapter ${step.chapter}`);
}

// The built pages.
const built = path => existsSync(join(dist, path));
if (!built("manual/index.html")) failures.push("manual/index.html is not built");
for (const slug of slugs) if (!built(`manual/${slug}.html`)) failures.push(`manual/${slug}.html is not built`);
const guidePages = new Set(CHAPTERS.flatMap(chapter => chapter.guide.map(page => page.path)));
// The home page links these two guide pages besides the chapters' own.
guidePages.add("/guide/requirements");
guidePages.add("/guide/privacy");
for (const path of guidePages) {
    for (const locale of ["ja", "en"]) if (!built(`${locale}${path}.html`)) failures.push(`${locale}${path} is linked from the manual but not built`);
}

// The pictures.
const pictures = [
    "manual/brand/app-icon.svg", "manual/brand/favicon.svg", "manual/brand/wordmark-light.webp", "manual/brand/wordmark-dark.webp",
    "manual/mascot/mascot-hero.webp", ...FACES.map(face => `manual/mascot/face-${face}.webp`),
];
for (const path of pictures) if (!built(path)) failures.push(`${path} is missing`);

// The built home page carries the download link for readers without scripts.
if (built("manual/index.html")) {
    const html = readFileSync(join(dist, "manual/index.html"), "utf8");
    if (!html.includes("https://github.com/kein5/VRCT-VOX/releases/latest")) failures.push("the built home page has no link to the latest release");
}

if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
}
console.log(`manual ok (${CHAPTERS.length} chapters, ${guidePages.size} guide pages in 2 languages, ${pictures.length} pictures)`);

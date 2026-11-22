// Checks that every link to a heading in the built user guide finds that heading, and that the
// pages and headings opened from outside the site are built.
//
//   node tools/check_site_anchors.mjs site/dist
//
// A link to a missing #heading on a page that exists does not fail the build: the reader lands at
// the top of the page. This reads every page, collects its ids, and looks up every same-site link
// with a #fragment. Released apps, the READMEs and SUPPORT.md open some pages and headings
// directly (OUTSIDE below); they must stay where they are whatever the site is built with.
// Exits 1 and lists the links whose heading is missing.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(process.argv[2] ?? join(root, "site/dist"));
const BASE = "/astarot/";

const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
    });
const pages = new Map();
for (const file of walk(dist).filter((path) => path.endsWith(".html"))) {
    const html = readFileSync(file, "utf8");
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
    pages.set(relative(dist, file).split("\\").join("/"), { html, ids });
}

const pageFor = (from, path) => {
    let target = path.startsWith(BASE) ? path.slice(BASE.length) : posix.join(posix.dirname(from), path);
    if (target === "" || target.endsWith("/")) target += "index";
    return target.endsWith(".html") ? target : `${target}.html`;
};

const failures = [];
let checked = 0;
for (const [from, { html, ids }] of pages) {
    for (const [, href] of html.matchAll(/<a\s[^>]*href="([^"]*#[^"]+)"/g)) {
        if (/^[a-z]+:/i.test(href)) continue; // Another site.
        const [path, fragment] = href.split("#");
        const target = path ? pageFor(from, path) : from;
        const page = path ? pages.get(target) : { ids };
        if (!page) continue; // A missing page fails the site build itself (dead link check).
        const id = decodeURIComponent(fragment);
        checked++;
        if (!page.ids.has(id)) failures.push(`${from}: #${id} is not a heading in ${target}`);
    }
}
// Opened from outside the site: src-ui/logics/ui_configs.ts (the app's help, setup and model
// links; each model setting opens its own heading of custom-models), README.md,
// docs/readmes/README.ja.md and SUPPORT.md.
const OUTSIDE = {
    "index.html": [],
    "guide/troubleshooting.html": [],
    "guide/first-setup.html": [],
    "guide/custom-models.html": ["tts", "asr", "whisper-server", "rvc", "seed-vc", "translation"],
    "guide/requirements.html": [],
    "guide/support.html": [],
};
for (const locale of ["ja", "en"]) {
    for (const [page, headings] of Object.entries(OUTSIDE)) {
        const built = pages.get(`${locale}/${page}`);
        if (!built) {
            failures.push(`${locale}/${page} is opened from outside the site but not built`);
            continue;
        }
        for (const id of headings) {
            checked++;
            if (!built.ids.has(id))
                failures.push(`${locale}/${page}: #${id} is opened from outside the site but is not a heading`);
        }
    }
}

for (const failure of [...new Set(failures)]) console.error(failure);
if (failures.length) process.exit(1);
console.log(`anchors ok (${checked} links)`);

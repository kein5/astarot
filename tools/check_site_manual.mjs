// Checks the pages of the retired ASTAROT manual in the built guide
// (site/theme/lib/manualRedirects.mjs): each one is built, sends the reader on to the guide page
// that covered it, and that page is built in Japanese and in English.
//
//   node tools/check_site_manual.mjs site/dist
//
// The manual was published at /manual/ and /manual/<chapter> from 0.5.0 to 0.6.x; its addresses
// keep working (docs/design/site-redesign, 1.5).
// Exits 1 and names what is missing.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(process.argv[2] ?? join(root, "site/dist"));
const { MANUAL_REDIRECTS } = await import(pathToFileURL(join(root, "site/theme/lib/manualRedirects.mjs")));
const SITE = "https://kein5.github.io/astarot/";
const BASE = "/astarot/";

const failures = [];
const htmlFor = path => (path.endsWith("/") ? `${path}index.html` : `${path}.html`).replace(/^\//, "");
const built = path => existsSync(join(dist, path));

if (MANUAL_REDIRECTS.length !== 11) failures.push(`${MANUAL_REDIRECTS.length} manual pages, the manual had 11`);
for (const { path, to } of MANUAL_REDIRECTS) {
    const file = htmlFor(path);
    if (!built(file)) {
        failures.push(`${file} is not built`);
        continue;
    }
    for (const locale of ["ja", "en"]) {
        const target = htmlFor(`/${locale}${to}`);
        if (!built(target)) failures.push(`${path} sends readers to ${target}, which is not built`);
    }
    const html = readFileSync(join(dist, file), "utf8");
    // In the head, before anything is drawn: the script that picks the language, the canonical
    // address and, without scripts, the Japanese page.
    const head = html.slice(0, html.indexOf("</head>"));
    const target = JSON.stringify(to);
    if (!head.includes("location.replace(") || !head.includes(target)) failures.push(`${path}: no script in the head sends readers to ${to}`);
    if (!head.includes(`rel="canonical" href="${SITE}ja${to}"`)) failures.push(`${path}: the canonical link does not name ${SITE}ja${to}`);
    if (!head.includes(`url=${BASE}ja${to}`)) failures.push(`${path}: no refresh for readers without scripts`);
    // The page itself links both languages for browsers that do not follow the redirect.
    for (const locale of ["ja", "en"]) {
        if (!html.includes(`href="${BASE}${locale}${to}"`)) failures.push(`${path}: the page does not link ${BASE}${locale}${to}`);
    }
}

// The manual's icon stays where tools/astarot_favicon_small.py writes it.
if (!built("manual/brand/favicon.ico")) failures.push("manual/brand/favicon.ico is missing");

if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
}
console.log(`manual ok (${MANUAL_REDIRECTS.length} pages send readers to the guide in 2 languages)`);

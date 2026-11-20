// Checks that the built user guide can be searched by words in the middle of a Japanese sentence,
// and by English words: loads each language's search index as the browser does and searches it
// with Rspress's own search code (its LocalProvider), not a copy of it.
//
//   node tools/check_site_search.mjs site/dist
//
// The provider imports the browser runtime only for the index's file name; a module hook gives it
// an empty stand-in, and the index is handed to it from the built site.
// Exits 1 and names the word when a search finds nothing, or the page it should have found.
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(process.argv[2] ?? join(root, "site/dist"));
const provider = join(root, "site/node_modules/@rspress/core/dist/theme/components/Search/logic/providers/LocalProvider.js");

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "@rspress/core/runtime") {
            return { url: "data:text/javascript,export const searchIndexHash = {}", shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});
globalThis.__WEBPACK_PUBLIC_PATH__ = "/";
const { LocalProvider } = await import(pathToFileURL(provider));

// Each word, and a page it is only in the middle of a sentence of.
const WORDS = {
    ja: [
        ["読み上げ", "/ja/features/tts"],
        ["仮想マイク", "/ja/guide/windows-audio"],
        ["ボイスチェンジャー", "/ja/features/voice-conversion"],
        ["自分のモデル", "/ja/guide/custom-models"],
        ["証明書", "/ja/features/integrations"],
    ],
    en: [
        ["voice changer", "/en/features/voice-conversion"],
        ["virtual microphone", "/en/guide/windows-audio"],
        ["own model", "/en/guide/custom-models"],
    ],
};

const failures = [];
const files = readdirSync(join(dist, "static"));
for (const [locale, words] of Object.entries(WORDS)) {
    const file = files.find(name => name.startsWith(`search_index.${locale}.`) && name.endsWith(".json"));
    if (!file) {
        failures.push(`${locale}: no search index in ${join(dist, "static")}`);
        continue;
    }
    const pages = JSON.parse(readFileSync(join(dist, "static", file), "utf8"));
    const search = new LocalProvider();
    search.fetchSearchIndex = async () => pages;
    await search.init({ currentLang: locale, currentVersion: "", versioned: false });
    for (const [word, page] of words) {
        const [{ hits }] = await search.search({ keyword: word, limit: 50 });
        const found = hits.map(hit => hit.routePath);
        if (!found.length) failures.push(`${locale}: nothing found for "${word}"`);
        else if (!found.includes(page)) failures.push(`${locale}: "${word}" did not find ${page} (found ${found.slice(0, 5).join(", ")})`);
        else console.log(`${locale}: "${word}" → ${found.length} (${found.slice(0, 3).join(", ")})`);
    }
}
if (failures.length) {
    for (const failure of failures) console.error(failure);
    process.exit(1);
}
console.log("search ok");

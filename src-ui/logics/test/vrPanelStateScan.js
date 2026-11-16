// Which atoms the VR panel's views read, found by reading their source (SEC-03).
//
// Starts at every module under src-ui/views/vr and follows their imports. Relative imports and
// aliases that name one file are followed whole. Names taken from a barrel (@logics_common,
// @logics_main, @logics_configs) are followed to the file that defines them. Category hooks
// (useVr, useDevice, ...) stand for every setting of their SETTINGS_ARRAY category. `useStore_X`
// and `Atom_X` anywhere in a followed file count as the atom X.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC = path.join(ROOT, "src-ui");

const ALIASES = {
    "@store": "src-ui/logics/store",
    "@utils": "src-ui/logics/utils",
    "@ui_configs": "src-ui/logics/ui_configs",
    "@useStdoutToPython": "src-ui/logics/common/useStdoutToPython",
    "@useReceiveRoutes": "src-ui/logics/useReceiveRoutes",
    "@useI18n": "locales/useI18n.js",
    "@logics_common": "src-ui/logics/common",
    "@logics_main": "src-ui/logics/main",
    "@logics_configs": "src-ui/logics/configs",
    "@logics": "src-ui/logics",
    "@setting_box": "src-ui/views/app/config_page/setting_section/setting_box/index",
    "@common_components": "src-ui/views/common_components/index",
};
const BARRELS = new Set(["@logics_common", "@logics_main", "@logics_configs", "@setting_box", "@common_components"]);
const CATEGORY_HOOKS = {
    useAppearance: "Appearance", useDevice: "Device", useTranslation: "Translation",
    useTranscription: "Transcription", useVr: "Vr", useOthers: "Others",
    useAdvancedSettings: "AdvancedSettings", useUpdater: "Updater", useOcr: "Ocr",
};
const SKIPPED = /\.(scss|css|svg|png|json)(\?.*)?$|\.css\.ts$/;

const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

const resolveFile = (base) => {
    // Files move from .js to .ts in steps (ADR-010), so either may be there.
    const candidates = [base, ...[".js", ".jsx", ".ts", ".tsx"].flatMap(ext => [`${base}${ext}`, path.join(base, `index${ext}`)])];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
};

const resolveSpecifier = (from, spec) => {
    if (SKIPPED.test(spec)) return null;
    if (spec.startsWith(".")) return resolveFile(path.resolve(path.dirname(from), spec));
    const alias = Object.keys(ALIASES).find(name => spec === name || spec.startsWith(`${name}/`));
    if (!alias) return null; // a package from node_modules
    return resolveFile(path.join(ROOT, ALIASES[alias], spec.slice(alias.length)));
};

const IMPORT = /(?:import|export)\s+(?:type\s+)?([\w$]+\s*,?\s*)?(\{[^}]*\}|\*\s*(?:as\s+[\w$]+)?)?\s*from\s*["']([^"']+)["']/g;
const names = (braces) => (braces && braces.startsWith("{") ? braces : "").replace(/[{}]/g, "").split(",")
    .map(part => part.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);

// The file in a barrel (and the barrels it re-exports) that defines `name`.
const definingFile = (barrel, name, seen = new Set()) => {
    if (!barrel || seen.has(barrel)) return null;
    seen.add(barrel);
    const source = stripComments(fs.readFileSync(barrel, "utf8"));
    if (new RegExp(`export\\s+(?:async\\s+)?(?:const|function|let|class)\\s+${name}\\b`).test(source)) return barrel;
    for (const match of source.matchAll(IMPORT)) {
        const [, , braces, spec] = match;
        const target = resolveSpecifier(barrel, spec);
        if (!target) continue;
        if (braces && braces.startsWith("{") && names(braces).includes(name)) {
            return definingFile(target, name, seen) ?? target;
        }
        if (braces && braces.startsWith("*")) {
            const found = definingFile(target, name, seen);
            if (found) return found;
        }
    }
    return null;
};

export const settingsByCategory = () => {
    const source = fs.readFileSync(resolveFile(path.join(SRC, "logics/configs/config_page_setter/ui_config_setter")), "utf8");
    const byCategory = {};
    for (const [, category, base] of source.matchAll(/Category:\s*"(\w+)",\s*Base_Name:\s*"(\w+)"/g)) {
        (byCategory[category] ??= []).push(base);
    }
    return byCategory;
};

export const scanVrPanelState = () => {
    const vrDir = path.join(SRC, "views/vr");
    const queue = fs.readdirSync(vrDir).filter(name => /\.(js|jsx|ts|tsx)$/.test(name) && !/\.test\.|\.d\.ts$|\.css\.ts$/.test(name))
        .map(name => path.join(vrDir, name));
    const seen = new Set();
    const atoms = new Set();
    const categories = new Set();
    while (queue.length) {
        const file = queue.pop();
        if (seen.has(file)) continue;
        seen.add(file);
        const source = stripComments(fs.readFileSync(file, "utf8"));
        for (const [, name] of source.matchAll(/\buseStore_(\w+)/g)) atoms.add(name);
        for (const [, name] of source.matchAll(/\bAtom_(\w+)/g)) atoms.add(name);
        for (const match of source.matchAll(IMPORT)) {
            const [, , braces, spec] = match;
            const alias = Object.keys(ALIASES).find(name => spec === name);
            const resolved = resolveSpecifier(file, spec);
            const isBarrel = (alias && BARRELS.has(alias)) || (resolved && /[\\/]index\.[jt]sx?$/.test(resolved));
            if (isBarrel && resolved) {
                const barrel = resolved;
                // `import * as x` from a barrel could use anything in it: follow the whole barrel.
                if (braces && braces.startsWith("*")) queue.push(barrel);
                for (const name of names(braces)) {
                    if (CATEGORY_HOOKS[name]) categories.add(CATEGORY_HOOKS[name]);
                    else {
                        const target = definingFile(barrel, name);
                        if (target) queue.push(target);
                    }
                }
                continue;
            }
            const target = resolveSpecifier(file, spec);
            if (target && target !== resolveFile(path.join(ROOT, ALIASES["@store"]))) queue.push(target);
        }
    }
    // Category hooks also read NotificationStatus (useSettingsLogics -> useNotificationStatus).
    if (categories.size) atoms.add("NotificationStatus");
    return { atoms, categories, files: [...seen].map(file => path.relative(ROOT, file).replaceAll("\\", "/")).sort() };
};

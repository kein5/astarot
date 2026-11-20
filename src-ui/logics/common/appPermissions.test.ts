import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "vitest";

// Security audit SEC-05: the windows get only the native permissions the UI uses. The UI reads
// and writes no files, makes no HTTP requests of its own and starts no programs, so the fs, http
// and shell plugins are not in the app at all: the backend runs inside the app (#285) and the
// main window reaches it through the app's own backend_* commands. Script injected into a window
// then cannot write or delete files, start a program or open a site the link list does not
// allow. These tests fail when a permission comes back without a use.
const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const capabilityFolder = new URL("src-tauri/capabilities/", root);
// A permission is named alone or with its scope (Tauri's capability files).
type Permission = string | { identifier: string };
interface Capability {
    name: string;
    permissions: Permission[];
}
const capabilities: Capability[] = readdirSync(capabilityFolder).filter(name => name.endsWith(".json"))
    .map(name => ({ name, ...JSON.parse(readFileSync(new URL(name, capabilityFolder), "utf8")) }));
const id = (permission: Permission) => typeof permission === "string" ? permission : permission.identifier;
const plugin = (permission: Permission) => id(permission).split(":")[0];

const sources = (folder: URL, found: URL[] = []) => {
    for (const name of readdirSync(folder)) {
        const path = new URL(name, folder);
        if (statSync(path).isDirectory()) sources(new URL(`${name}/`, folder), found);
        else if (/\.(js|jsx|ts|tsx)$/.test(name) && !name.includes(".test.") && !name.endsWith(".d.ts")) found.push(path);
    }
    return found;
};
const ui = sources(new URL("src-ui/", root)).map(path => ({ path: path.pathname, text: readFileSync(path, "utf8") }));

test("no window may use the file system, make HTTP requests or start programs through a plugin", () => {
    const granted = capabilities.flatMap(capability => capability.permissions
        .filter(permission => ["fs", "http", "shell"].includes(plugin(permission)))
        .map(permission => `${capability.name}: ${id(permission)}`));
    assert.deepEqual(granted, []);
    const native = read("src-tauri/src/lib.rs") + read("src-tauri/Cargo.toml");
    assert.doesNotMatch(native, /tauri[-_]plugin[-_](fs|http|shell)\b/);
    const packages = JSON.parse(read("package.json"));
    assert.deepEqual(Object.keys({ ...packages.dependencies, ...packages.devDependencies })
        .filter(name => /^@tauri-apps\/plugin-(fs|http|shell)$/.test(name)), []);
    const imports = ui.filter(file => /@tauri-apps\/plugin-(fs|http|shell)|plugin:(fs|http|shell)\|/.test(file.text));
    assert.deepEqual(imports.map(file => file.path), []);
});

test("the app ships no backend program beside it", () => {
    const config = JSON.parse(read("src-tauri/tauri.conf.json"));
    assert.equal(config.bundle.externalBin, undefined);
});

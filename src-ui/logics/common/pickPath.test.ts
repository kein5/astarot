import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule } from "../test/hookHarness.ts";

// #1231: the field's picker asks the shell for a folder (pick_folder) or a file (pick_file), the
// file of the kinds the field takes. What comes back fills the field; a cancel and a picker that
// cannot open change nothing.
async function picker(answer: (command: string, payload: unknown) => unknown) {
    const calls: [string, unknown][] = [];
    const module = await loadModule<typeof import("./pickPath.ts")>(new URL("./pickPath.ts", import.meta.url), hooks(), {
        "@tauri-apps/api/core": { invoke: async (command: string, payload: unknown) => { calls.push([command, payload]); return answer(command, payload); } },
    });
    return { ...module, calls };
}

test("a folder field asks for a folder, opening in the folder the field holds", async () => {
    const p = await picker(() => "/models/rvc-runtime");
    assert.deepEqual(await p.pickPath({ kind: "folder" }, "  /models/old  ", "Choose folder", "unused"), { ok: true, path: "/models/rvc-runtime" });
    assert.deepEqual(p.calls, [["pick_folder", { initialPath: "/models/old", title: "Choose folder" }]]);
});

test("a file field asks for a file of its kinds, or any file when it names none", async () => {
    const p = await picker(() => "C:\\models\\voice.pth");
    assert.deepEqual(await p.pickPath({ kind: "file", extensions: ["pth"] }, "", "Choose file", "Files (*.pth)"), { ok: true, path: "C:\\models\\voice.pth" });
    await p.pickPath({ kind: "file" }, null, "Choose file", "Files ()");
    await p.pickPath({ kind: "file", extensions: [] }, "   ", "Choose file", "Files ()");
    assert.deepEqual(p.calls, [
        ["pick_file", { initialPath: null, title: "Choose file", filters: [{ name: "Files (*.pth)", extensions: ["pth"] }] }],
        ["pick_file", { initialPath: null, title: "Choose file", filters: null }],
        ["pick_file", { initialPath: null, title: "Choose file", filters: null }],
    ]);
});

test("a cancel gives no path, and a picker that cannot open says which one", async () => {
    for (const answer of [null, "", "  ", 7]) {
        const p = await picker(() => answer);
        assert.deepEqual(await p.pickPath({ kind: "file" }, null, "t", "f"), { ok: true, path: null }, String(answer));
    }
    const failing = await picker(() => { throw new Error("main_window_forbidden"); });
    assert.deepEqual(await failing.pickPath({ kind: "file", extensions: ["gguf"] }, null, "t", "f"), { ok: false, error_code: "file_picker_unavailable" });
    assert.deepEqual(await failing.pickPath({ kind: "folder" }, null, "t", "f"), { ok: false, error_code: "folder_picker_unavailable" });
});

test("the kinds of file are named by their patterns", async () => {
    const p = await picker(() => null);
    assert.equal(p.filePatterns(["gguf"]), "*.gguf");
    assert.equal(p.filePatterns(["pth", "index"]), "*.pth, *.index");
    assert.equal(p.filePatterns([]), "");
});

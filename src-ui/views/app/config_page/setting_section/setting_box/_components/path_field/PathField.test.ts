import assert from "node:assert/strict";
import { test } from "vitest";
import { find, findIn, hooks, kitStandIns, loadModule } from "../../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../../logics/test/hookHarness.ts";
import type { PathPick, PickedPath } from "../../../../../../../logics/common/pickPath.ts";

// #1231: a path field is typed, pasted or picked. Beside the field, a button opens the system's
// picker for a file of the field's kinds or for a folder; a picked path fills the field as typing
// does, a cancel changes nothing, and a picker that cannot open is said under the field.
const t = (key: string, options?: Record<string, unknown>) => options ? `${key}:${JSON.stringify(options)}` : key;

async function load(answer: () => PickedPath | Promise<PickedPath> = () => ({ ok: true, path: null })) {
    const runtime = hooks(), asked: unknown[][] = [];
    const module = await loadModule<typeof import("./PathField.tsx")>(new URL("./PathField.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t }) },
        "../../../../../../../logics/common/pickPath.ts": {
            filePatterns: (extensions: readonly string[]) => extensions.map(extension => `*.${extension}`).join(", "),
            pickPath: async (...args: unknown[]) => { asked.push(args); return answer(); },
        },
        "../field_problem/FieldProblem": { FieldProblem: "problem" },
    });
    return { runtime, module, asked };
}

const GGUF: PathPick = { kind: "file", extensions: ["gguf"] };

// The field with its value and what it was changed to.
async function pathField() {
    const { runtime, module } = await load();
    const changes: string[] = [];
    let value = "/models/old.gguf";
    const draw = (props: { pick?: PathPick; disabled?: boolean; "aria-describedby"?: string } = {}) =>
        runtime.render(module.PathField, { value, label: "Model GGUF path", pick: GGUF, maxLength: 4096, placeholder: "e.g. model.gguf",
            id: "row-field", onChange: (next: string) => { changes.push(next); value = next; }, ...props });
    const field = (tree: TreeNode) => findIn(tree, node => node.type === kitStandIns.TextField);
    const picker = (tree: TreeNode) => findIn(tree, node => node.type === module.PathPickButton);
    return { draw, field, picker, changes };
}

// The button alone, pressed, with what it asked the picker and what it said back.
async function pickButton(answer: () => PickedPath | Promise<PickedPath>, props: { pick?: PathPick; disabled?: boolean } = {}) {
    const { runtime, module, asked } = await load(answer);
    const picked: string[] = [], unavailable: string[] = [];
    const draw = () => runtime.render(module.PathPickButton, { pick: GGUF, label: "Model GGUF path", current: "/models/old.gguf",
        onPicked: (path: string) => picked.push(path), onUnavailable: (code: string) => unavailable.push(code), ...props });
    const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
    const press = async () => { draw().props.onClick(); await settle(); };
    return { draw, press, settle, asked, picked, unavailable };
}

test("the field fills the column beside its picker; the row's label and description reach the field", async () => {
    const p = await pathField();
    const tree = p.draw({ "aria-describedby": "row-description" });
    assert.equal(tree.props["data-path-field"], "file");
    const field = p.field(tree).props;
    // A path in the monospaced font, never spell-checked.
    assert.deepEqual([field.mono, field.spellCheck, field.value, field.maxLength, field.placeholder, field.id, field["aria-describedby"], field.disabled],
        [true, false, "/models/old.gguf", 4096, "e.g. model.gguf", "row-field", "row-description", undefined]);
    const picker = p.picker(tree).props;
    assert.deepEqual([picker.pick, picker.label, picker.current, picker.disabled], [GGUF, "Model GGUF path", "/models/old.gguf", undefined]);
    assert.equal(p.picker(p.draw({ disabled: true })).props.disabled, true);
    assert.equal(p.field(p.draw({ disabled: true })).props.disabled, true);
});

test("typing, pasting and picking change the field alike", async () => {
    const p = await pathField();
    p.field(p.draw()).props.onChange({ target: { value: "/typed/model.gguf" } });
    p.picker(p.draw()).props.onPicked("/picked/model.gguf");
    assert.deepEqual(p.changes, ["/typed/model.gguf", "/picked/model.gguf"]);
    assert.equal(p.field(p.draw()).props.value, "/picked/model.gguf");
});

test("a picker that cannot open is said under the field, which points to it until the path changes", async () => {
    const p = await pathField();
    p.picker(p.draw()).props.onUnavailable("file_picker_unavailable");
    const tree = p.draw({ "aria-describedby": "row-description" });
    const problem = findIn(tree, node => node.type === "problem").props;
    assert.equal(problem.text, "path_picker.file_picker_unavailable");
    assert.equal(p.field(tree).props["aria-describedby"], `row-description ${problem.id}`);
    assert.deepEqual(p.changes, []);
    p.field(tree).props.onChange({ target: { value: "/typed.gguf" } });
    assert.equal(find(p.draw(), node => node.type === "problem"), null, "typing the path instead clears it");
});

test("the button names the field it picks for, a file or a folder", async () => {
    const file = (await pickButton(() => ({ ok: true, path: null }))).draw();
    assert.equal(file.type, kitStandIns.Button);
    assert.deepEqual([file.props.children, file.props["aria-label"], file.props.disabled, file.props["data-path-pick"]],
        ["path_picker.choose_file", 'path_picker.choose_file_for:{"field":"Model GGUF path"}', false, "file"]);
    const folder = (await pickButton(() => ({ ok: true, path: null }), { pick: { kind: "folder" } })).draw();
    assert.deepEqual([folder.props.children, folder.props["aria-label"], folder.props["data-path-pick"]],
        ["path_picker.choose_folder", 'path_picker.choose_folder_for:{"field":"Model GGUF path"}', "folder"]);
});

test("a picked file comes back; the picker opens in the field's folder and shows only the field's kinds", async () => {
    const b = await pickButton(() => ({ ok: true, path: "/picked/model.gguf" }));
    await b.press();
    assert.deepEqual(b.asked, [[GGUF, "/models/old.gguf", 'path_picker.choose_file_for:{"field":"Model GGUF path"}', 'path_picker.filter:{"patterns":"*.gguf"}']]);
    assert.deepEqual([b.picked, b.unavailable], [["/picked/model.gguf"], []]);
});

test("a cancel changes nothing, and a picker that cannot open says so", async () => {
    const cancel = await pickButton(() => ({ ok: true, path: null }));
    await cancel.press();
    assert.deepEqual([cancel.asked.length, cancel.picked, cancel.unavailable], [1, [], []]);
    const broken = await pickButton(() => ({ ok: false, error_code: "folder_picker_unavailable" }), { pick: { kind: "folder" } });
    await broken.press();
    assert.deepEqual([broken.picked, broken.unavailable], [[], ["folder_picker_unavailable"]]);
});

test("a disabled button opens nothing, and one picker opens at a time", async () => {
    const off = await pickButton(() => ({ ok: true, path: "/x.gguf" }), { disabled: true });
    assert.equal(off.draw().props.disabled, true);
    await off.press();
    assert.deepEqual([off.asked.length, off.picked], [0, []]);
    let release: (picked: PickedPath) => void = () => {};
    const slow = await pickButton(() => new Promise<PickedPath>(resolve => { release = resolve; }));
    slow.draw().props.onClick();
    slow.draw().props.onClick();
    assert.equal(slow.asked.length, 1, "the second press waits for the open picker");
    // The button stays enabled while the picker is open, so focus comes back to it.
    assert.equal(slow.draw().props.disabled, false);
    release({ ok: true, path: "/picked.gguf" });
    await slow.settle();
    assert.deepEqual(slow.picked, ["/picked.gguf"]);
    slow.draw().props.onClick();
    assert.equal(slow.asked.length, 2, "the picker opens again once it closed");
});

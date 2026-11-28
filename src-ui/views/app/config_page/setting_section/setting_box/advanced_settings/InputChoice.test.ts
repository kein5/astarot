import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { findIn, hooks, kitStandIns, loadModule, nodesIn, treeNode } from "../../../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../../../logics/test/hookHarness.ts";

// "Use this model" on a recognition model's card (InputChoice.tsx, reported on 0.7.0-beta.4): a menu
// of Mic input and Listening, named with the model. An input that uses the model already says so and
// is not pressed; while no input can take a model, the menu says why and its items wait.

const textOf = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(textOf).join("");
    const node = treeNode(value);
    return node ? textOf(node.props.children) : "";
};

async function menu(context: TestContext) {
    const runtime = hooks();
    context.onTestFinished(() => runtime.unmount());
    const { InputChoice } = await loadModule<typeof import("./InputChoice.tsx")>(new URL("./InputChoice.tsx", import.meta.url), runtime, {
        "@useI18n": { useI18n: () => ({ t: (key: string, values?: object) => values ? `${key} ${JSON.stringify(values)}` : key }) },
        "./InputChoice.css.ts": { menu: "menu", item: "item", waiting: "waiting" },
    });
    const chosen: string[] = [];
    const draw = (props: Partial<Parameters<typeof InputChoice>[0]> = {}) => runtime.render(InputChoice, {
        name: "Qwen3-ASR 0.6B", id: "qwen", used: [], waiting: null, disabled: false, className: "press",
        onChoose: (input: string) => { chosen.push(input); }, ...props });
    const items = (tree: unknown) => nodesIn(tree).filter(node => node.type === kitStandIns.Button);
    return { draw, chosen, items };
}

test("the card's button names the model and opens a menu of the two inputs", async context => {
    const m = await menu(context);
    const tree = m.draw();
    const trigger = findIn(tree, node => node.type === "button" && node.props["data-use-model"] === "qwen");
    assert.deepEqual([trigger.props.className, trigger.props["aria-label"], textOf(trigger), trigger.props.disabled],
        ["primary press", 'model_catalog.use_named {"name":"Qwen3-ASR 0.6B"}', "model_catalog.use", false]);
    const content = findIn(tree, node => node.type === kitStandIns.PopoverContent);
    assert.deepEqual([content.props.role, content.props["aria-label"]], ["group", 'model_catalog.use_for.label {"name":"Qwen3-ASR 0.6B"}']);
    assert.deepEqual(m.items(tree).map(item => [item.props["data-input"], textOf(item), item.props.disabled]),
        [["mic", "model_catalog.use_for.mic", false], ["speaker", "model_catalog.use_for.speaker", false]]);
    // An item is the choice for that input.
    m.items(tree)[1].props.onClick();
    assert.deepEqual(m.chosen, ["speaker"]);
    // Without the card's hit area the button keeps the primary look alone; a download that runs keeps it waiting.
    const plain = findIn(m.draw({ className: undefined, disabled: true }), node => node.type === "button" && node.props["data-use-model"] === "qwen");
    assert.deepEqual([plain.props.className, plain.props.disabled], ["primary", true]);
});

test("an input that uses the model says so and is not pressed, and a reason to wait keeps both items waiting", async context => {
    const m = await menu(context);
    assert.deepEqual(m.items(m.draw({ used: ["mic"] })).map((item: TreeNode) => [textOf(item), item.props.disabled]),
        [["model_catalog.status.in_use_mic", true], ["model_catalog.use_for.speaker", false]]);
    const waiting = m.draw({ waiting: "source_models.running" });
    assert.equal(textOf(findIn(waiting, node => node.type === "p")), "source_models.running");
    assert.deepEqual(m.items(waiting).map((item: TreeNode) => item.props.disabled), [true, true]);
    assert.equal(nodesIn(m.draw()).filter(node => node.type === "p").length, 0, "nothing to say otherwise");
});

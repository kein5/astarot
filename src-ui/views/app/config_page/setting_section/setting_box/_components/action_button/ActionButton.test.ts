import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find, findIn, nodesIn } from "../../../../../../../logics/test/hookHarness.ts";

// #614: a row is named by the thing it holds, such as an address. What pressing its button does
// is the button's own name and tooltip, not words in brackets in the row's name.

async function button(props: { label?: string; action_label?: string }) {
    const runtime = hooks();
    const { ActionButton } = await loadModule<typeof import("./ActionButton.tsx")>(new URL("./ActionButton.tsx", import.meta.url), runtime);
    return runtime.render(ActionButton, { IconComponent: () => null, ...props });
}

test("with an action label the button is named by what pressing does, and shows it as a tooltip", async () => {
    const tree = await button({ label: "OBS URL", action_label: "Copy the OBS URL" });
    const control = findIn(tree, node => node.type === "button");
    assert.equal(control.props["aria-label"], "Copy the OBS URL");
    const tip = findIn(tree, node => node.props?.role === "tooltip");
    assert.equal(tip.props.children, "Copy the OBS URL");
    // The words are the name already: the bubble is not read again.
    assert.equal(tip.props["aria-hidden"], "true");
    assert.equal(tip.props["data-slot"], "tooltip-content");
    // The bubble comes right after the button, which opens it on hover and on keyboard focus (CSS).
    assert.deepEqual(nodesIn(tree).filter(node => node.type === "button" || node.props?.role === "tooltip").map(node => node.type), ["button", "span"]);
});

test("without one the button keeps the row's label as its name and has no tooltip", async () => {
    const tree = await button({ label: "Open the settings folder" });
    assert.equal(findIn(tree, node => node.type === "button").props["aria-label"], "Open the settings folder");
    assert.equal(find(tree, node => node.props?.role === "tooltip"), null);
});

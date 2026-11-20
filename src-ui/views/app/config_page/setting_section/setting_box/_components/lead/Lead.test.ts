import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule, find, findIn, nodesIn } from "../../../../../../../logics/test/hookHarness.ts";

// #614: what must be known before acting: one sentence on screen, and its details as the hint
// after it. Drawn by itself, the mark takes keyboard focus, as no control points at it; in a row,
// the bubble is what the control's description points at and opens with focus in the row.

async function lead(hints: boolean, props: { text: string; details?: string; id?: string; details_id?: string; row?: boolean }) {
    const runtime = hooks();
    const { Lead } = await loadModule<typeof import("./Lead.tsx")>(new URL("./Lead.tsx", import.meta.url), runtime, {
        "../description/Description": { Description: "description" },
        "../hint/Hint": { Hint: "hint", useHintDescriptions: () => hints },
    });
    return runtime.render(Lead, props);
}

test("on a page of hints, the sentence stays and its details are a hint the keyboard reaches", async () => {
    const tree = await lead(true, { text: "Sends the latest messages.", details: "Which messages, and how long they are kept.", id: "sent" });
    const line = findIn(tree, node => node.type === "p");
    assert.equal(line.props.id, "sent");
    assert.equal(line.props["data-hint-host"], true, "the pointer on the sentence opens the hint");
    assert.deepEqual(nodesIn(line).map(node => node.type), ["p", "span", "hint"]);
    assert.equal(findIn(line, node => node.type === "span").props.children, "Sends the latest messages.");
    assert.deepEqual(findIn(line, node => node.type === "hint").props, { text: "Which messages, and how long they are kept.", focusable: true });
    assert.ok(!find(tree, node => node.type === "description"));
});

test("on a page that shows descriptions, the details are a description under the sentence", async () => {
    const tree = await lead(false, { text: "Sends the latest messages.", details: "Which messages." });
    assert.deepEqual(nodesIn(tree).filter(node => typeof node.type === "string").map(node => node.type), ["p", "span", "description"]);
    assert.equal(findIn(tree, node => node.type === "p").props["data-hint-host"], undefined);
    assert.equal(findIn(tree, node => node.type === "description").props.text, "Which messages.");
});

test("a sentence without details is only the sentence", async () => {
    const tree = await lead(true, { text: "Sends the latest messages." });
    assert.deepEqual(nodesIn(tree).filter(node => typeof node.type === "string").map(node => node.type), ["p", "span"]);
    assert.equal(findIn(tree, node => node.type === "p").props["data-hint-host"], undefined);
});

test("in a row, the bubble has the id the control points at and opens with focus in the row; the mark takes no focus of its own", async () => {
    const tree = await lead(true, { row: true, text: "Sends that the app started.", details: "What goes with it.", id: "lead", details_id: "details" });
    const line = findIn(tree, node => node.type === "p");
    assert.deepEqual([line.props.id, line.props.className, line.props["data-hint-host"]], ["lead", "lead", true]);
    assert.deepEqual(findIn(line, node => node.type === "hint").props, { text: "What goes with it.", id: "details", row: true });
    // By itself it keeps a row's distance from its neighbours; in a row the label column spaces it.
    const alone = await lead(true, { text: "Sends the latest messages.", details: "Which messages." });
    assert.equal(findIn(alone, node => node.type === "p").props.className, "lead alone");
});

import assert from "node:assert/strict";
import { createElement } from "react";
import { test } from "vitest";
import { findIn, hooks, loadModule } from "../../../../../../../logics/test/hookHarness.ts";

// A setup fold labels its line with its title, so the settings search leads to the fold.

async function setupSection() {
    const runtime = hooks();
    const { SetupSection } = await loadModule<typeof import("./SetupSection.tsx")>(new URL("./SetupSection.tsx", import.meta.url), runtime, {
        "../description/Description": { Description: "description" },
        "../hint/Hint": { Hint: "hint", useHintDescriptions: () => false },
        "../fold/Fold": { Fold: "fold" },
    });
    return (props: Parameters<typeof SetupSection>[0]) => findIn(runtime.render(SetupSection, props), node => node.type === "fold", "the fold");
}

test("a setup fold with a text title labels its line with it, for the settings search", async () => {
    const draw = await setupSection();
    assert.equal(draw({ title: "Model and device", children: "rows" }).props.summaryProps["data-setting-label"], "Model and device");
    // A title that is not text names no row the search could match.
    const drawnTitle = createElement("span", null, "Model");
    assert.equal(draw({ title: drawnTitle, children: "rows" }).props.summaryProps["data-setting-label"], undefined);
});

// #1230: a setup the page's feature needs, and which is not done, starts open, so the missing
// step is the first thing seen; it opens when it becomes needed, and the user can still close it.
test("a needed setup starts open, opens when it becomes needed, and can still be closed", async () => {
    const draw = await setupSection();
    const open = (needed: boolean, attention = false) => draw({ title: "Models and servers", needed, attention, children: "rows" });
    assert.equal(open(true).props.open, true, "open from the start");
    open(true).props.onToggle({ currentTarget: { open: false } });
    assert.equal(open(true).props.open, false, "closed by the user while still needed");
    // Something in it that needs the user opens it still.
    assert.equal(open(true, true).props.open, true);
    // Done, it stays as the user left it; needed again, it opens.
    assert.equal(open(false).props.open, false);
    open(true);
    assert.equal(open(true).props.open, true, "opened when it became needed again");
    // A setup that is not needed is closed at first, as before.
    const other = await setupSection();
    assert.equal(other({ title: "Models and servers", children: "rows" }).props.open, false);
});

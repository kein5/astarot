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

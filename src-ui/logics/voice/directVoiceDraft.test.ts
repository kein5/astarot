import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { directRvcSelection, directSavedDraft, directSelectionPending, directShowsConversion } from "./directVoiceDraft.ts";
import type { DirectVoiceSelection, DirectVoiceVariant } from "./directVoiceDraft.ts";
import { changedPaths } from "./saveBar.ts";

const defaults: DirectVoiceSelection = { mode: "passthrough", engine: "rvc", rvc_runtime: "", rvc_model: "", rvc_index: "", rvc_pitch: 0 };
const rvcSaved: DirectVoiceSelection = { mode: "converted", engine: "rvc", rvc_runtime: "/rvc", rvc_model: "voice.pth", rvc_index: "", rvc_pitch: 3 };

// What the save bar shows for a form that has just opened: the changed fields and the pending selection.
const openedChanges = (settings: DirectVoiceSelection, variant: DirectVoiceVariant) => {
    const saved = directSavedDraft(defaults, settings, variant);
    // Saved settings always make a draft.
    assert.ok(saved);
    const draft = saved;
    return [...changedPaths(saved, draft), ...(directSelectionPending(draft, settings, variant) ? ["selection"] : [])];
};

test("#429: opening input forwarding with RVC saved puts nothing in the save bar", () => {
    assert.deepEqual(openedChanges(rvcSaved, "legacy"), []);
    assert.deepEqual(openedChanges({ ...rvcSaved, mode: "passthrough" }, "legacy"), []);
});

test("#429: a save from input forwarding keeps the RVC conversion", () => {
    // The form writes its draft; untouched, that is the saved value with the mode as saved.
    const written = directSavedDraft(defaults, rvcSaved, "legacy");
    assert.ok(written);
    assert.equal(written.mode, "converted");
    assert.equal(written.engine, "rvc");
    assert.equal(written.rvc_model, "voice.pth");
});

test("input forwarding shows and starts forwarding only", () => {
    const draft = directSavedDraft(defaults, rvcSaved, "legacy");
    assert.ok(draft);
    assert.equal(directShowsConversion(draft, "legacy"), false);
    assert.equal(directShowsConversion(draft, "all"), true);
    assert.equal(directShowsConversion({ ...draft, mode: "passthrough" }, "all"), false);
});

test("#436: the RVC page keeps the saved mode in its draft and asks for RVC on its own", () => {
    const passthrough = { ...rvcSaved, mode: "passthrough" };
    const draft = directSavedDraft(defaults, passthrough, "rvc");
    assert.ok(draft);
    // A save of the RVC fields writes the mode as saved: it does not switch direct voice.
    assert.equal(draft.mode, "passthrough");
    assert.deepEqual(changedPaths(draft, draft), []);
    assert.equal(directShowsConversion(draft, "rvc"), true, "the RVC fields show before RVC is selected");
    assert.equal(directSelectionPending(draft, passthrough, "rvc"), true);
    assert.equal(directSelectionPending(draft, rvcSaved, "rvc"), false);
    assert.equal(directSelectionPending(draft, { ...rvcSaved, engine: "seed-vc" }, "rvc"), true);
});

test("#436: the RVC button writes the saved settings with converted RVC, not the draft", () => {
    const passthrough = { ...rvcSaved, mode: "passthrough" };
    assert.deepEqual(directRvcSelection(defaults, passthrough), { ...defaults, ...passthrough, mode: "converted", engine: "rvc" });
    assert.deepEqual(directRvcSelection(defaults, { mode: "passthrough" }), { ...defaults, mode: "converted", engine: "rvc" });
});

test("the full form reports a mode it has changed as an edit, not as a pending selection", () => {
    const draft = directSavedDraft(defaults, rvcSaved, "all");
    assert.ok(draft);
    assert.deepEqual(openedChanges(rvcSaved, "all"), []);
    assert.deepEqual(changedPaths(draft, { ...draft, mode: "passthrough" }), [["mode"]]);
    assert.equal(directSelectionPending({ ...draft, mode: "passthrough" }, rvcSaved, "all"), false);
});

test("nothing is saved before the settings arrive", () => {
    assert.equal(directSavedDraft(defaults, null, "legacy"), null);
});

test("the direct voice settings read the saved value and selection through these helpers", () => {
    const view = readFileSync(new URL("../../views/app/config_page/setting_section/setting_box/advanced_settings/DirectVoiceSettings.tsx", import.meta.url), "utf8");
    assert.match(view, /directSavedDraft\(defaults, directState\.settings, variant\)/);
    assert.match(view, /directSelectionPending\(draft, directState\.settings, variant\)/);
    assert.match(view, /const converted = directShowsConversion\(draft, variant\)/);
    // No page rewrites the saved mode to forwarding, which a save would then write (#429).
    assert.doesNotMatch(view, /mode: "passthrough" \}/);
});

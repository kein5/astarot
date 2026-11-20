import assert from "node:assert/strict";
import { test } from "vitest";
import { hooks, loadModule } from "../../../../../../logics/test/hookHarness.ts";

// #614: what the guide checks is the row's description, a hint on the TTS page; that no virtual
// cable was found is a state, so it stays in sight.
const cases: [{ name: string }[], string, boolean][] = [[[{ name: "CABLE Input" }], "virtual_mic.entry.found", false], [[], "virtual_mic.entry.missing", true]];
for (const [cables, text, kept] of cases)
    test(`virtual microphone row with ${cables.length} cable(s): ${kept ? "kept in sight" : "a hint"}`, async () => {
        const runtime = hooks();
        const { VirtualMicEntry } = await loadModule<typeof import("./VirtualMicEntry.tsx")>(new URL("./VirtualMicEntry.tsx", import.meta.url), runtime, {
            "../../../../../../logics/voice/useVirtualMic": { useVirtualMic: () => ({ status: { supported: true, cables }, openGuide() {} }) },
            "../_components/form_row/FormRow": { FormRow: "row" },
        });
        const row = runtime.render(VirtualMicEntry);
        assert.ok(row);
        assert.equal(row.type, "row");
        assert.equal(row.props.description, text);
        assert.equal(row.props.keepDescription, kept);
    });

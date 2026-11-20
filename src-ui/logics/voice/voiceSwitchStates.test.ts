import assert from "node:assert/strict";
import { test } from "vitest";
import { voiceSwitchStates } from "./voiceActions.ts";

test("the voice switch states reach their listeners only when they change", () => {
    const seen: ReturnType<typeof voiceSwitchStates.get>[] = [];
    const stop = voiceSwitchStates.subscribe(() => seen.push(voiceSwitchStates.get()));
    const off = { on: false, pending: false };
    voiceSwitchStates.publish({ tts: off, rvc: off });
    assert.equal(seen.length, 0, "the same as at start");
    voiceSwitchStates.publish({ tts: { on: true, pending: false }, rvc: off });
    voiceSwitchStates.publish({ tts: { on: true, pending: false }, rvc: off });
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].tts, { on: true, pending: false });
    stop();
    voiceSwitchStates.publish({ tts: off, rvc: { on: false, pending: true } });
    assert.equal(seen.length, 1, "no longer listening");
    assert.deepEqual(voiceSwitchStates.get().rvc, { on: false, pending: true });
    voiceSwitchStates.publish({ tts: off, rvc: off });
});

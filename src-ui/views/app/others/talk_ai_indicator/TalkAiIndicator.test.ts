import assert from "node:assert/strict";
import { test } from "vitest";
import type { TestContext } from "vitest";
import { find, hooks, loadModule } from "../../../../logics/test/hookHarness.ts";
import type { TreeNode } from "../../../../logics/test/hookHarness.ts";
import * as talkAi from "../../../../logics/talk_ai/talkAi.ts";
import * as talkView from "../../../../logics/talk_ai/talkView.ts";

// The band that says Talk AI is sending (ADR-018, 2.4), with the real session hook: the voice and
// the screen are asked for only from its effects, which run after it is drawn (indicator_visible).

const OPENAI = talkAi.readCatalog([{ id: "openai", name: "OpenAI Realtime", vision: true, cloud: true, destination: "wss://api.openai.com/v1/realtime" }])[0];

async function load(context: TestContext) {
    const runtime = hooks();
    context.onTestFinished(() => runtime.unmount());
    const sent: [string, unknown][] = [];
    const send = async (endpoint: string, data?: unknown) => { sent.push([endpoint, data]); return true; };
    const session = await loadModule<typeof import("../../../../logics/talk_ai/useTalkAiSession.ts")>(
        new URL("../../../../logics/talk_ai/useTalkAiSession.ts", import.meta.url), runtime, {
            "@useStdoutToPython": { useStdoutToPython: () => ({ asyncStdoutToPython: send }) },
            "./talkAi.ts": talkAi, "./talkView.ts": talkView,
        });
    const module = await loadModule<typeof import("./TalkAiIndicator.tsx")>(new URL("./TalkAiIndicator.tsx", import.meta.url), runtime, {
        "../../../../logics/talk_ai/useTalkAiSession.ts": session, "../../../../logics/talk_ai/talkAi.ts": talkAi,
    });
    // The hook's own functions, read as the page reads them (the band calls the hook first, so
    // both use the same hook slots).
    const api = () => runtime.render(session.useTalkAiSession);
    const draw = (): TreeNode | null => runtime.render(module.TalkAiIndicator);
    const asked = (endpoint: string) => sent.filter(([name]) => name === endpoint);
    return { api, draw, sent, asked };
}

const words = (tree: TreeNode | null) => JSON.stringify(tree?.props.children ?? null);

test("the voice is asked for only once the band says it is sent", async context => {
    const s = await load(context);
    assert.equal(s.draw(), null, "no band without a conversation");
    await s.api().start(OPENAI, { device: null, share: false });
    assert.deepEqual(s.asked(talkView.START), [[talkView.START, talkAi.startRequest(OPENAI)]]);
    // Waiting for the answer and while connecting, the band is there and nothing more is asked.
    assert.equal(s.draw()?.props["data-talk-ai-indicator"], "connecting");
    s.api().answer({ session_id: 5, phase: "connecting" });
    assert.equal(s.draw()?.props["data-talk-ai-indicator"], "connecting");
    assert.deepEqual(s.asked(talkView.AUDIO), []);
    // Ready: nothing is asked by the status alone. Drawing the band that says the voice is sent asks for it.
    s.api().updateStatus({ session_id: 5, phase: "ready" });
    assert.deepEqual(s.asked(talkView.AUDIO), []);
    const band = s.draw();
    assert.equal(band?.props["data-talk-ai-indicator"], "sending");
    assert.match(words(band), /talk_ai\.indicator\.voice/);
    assert.deepEqual(s.asked(talkView.AUDIO), [[talkView.AUDIO, { session_id: 5, indicator_visible: true, output: null }]]);
    // Once only.
    s.draw();
    assert.equal(s.asked(talkView.AUDIO).length, 1);
});

test("the screen is asked for only after its consent, once the band shows it", async context => {
    const s = await load(context);
    await s.api().start(OPENAI, { device: talkAi.MANAGED_TTS, share: true });
    s.api().answer({ session_id: 9, phase: "ready" });
    s.draw();
    assert.deepEqual(s.asked(talkView.AUDIO), [[talkView.AUDIO, { session_id: 9, indicator_visible: true, output: talkAi.MANAGED_TTS, share_output: true }]]);
    s.api().answer({ session_id: 9, phase: "ready", sending_audio: true });
    // Ready and drawn, but without the screen's consent nothing of the screen is asked for.
    s.draw();
    assert.deepEqual(s.asked(talkView.SCREEN), []);
    s.api().share("vr", OPENAI.destination);
    assert.deepEqual(s.asked(talkView.SCREEN), []);
    const band = s.draw();
    assert.match(words(band), /talk_ai\.indicator\.screen/);
    assert.deepEqual(s.asked(talkView.SCREEN), [[talkView.SCREEN, talkAi.screenRequest(9, OPENAI.destination, "vr")]]);
    s.draw();
    assert.equal(s.asked(talkView.SCREEN).length, 1);
});

test("the band ends the conversation, and goes when the conversation ends", async context => {
    const s = await load(context);
    await s.api().start(OPENAI, { device: null, share: false });
    s.api().answer({ session_id: 2, phase: "ready" });
    const band = s.draw();
    const stop = find(band, node => node.props?.tone === "danger");
    assert.ok(stop);
    stop.props.onClick();
    assert.deepEqual(s.asked(talkView.STOP), [[talkView.STOP, undefined]]);
    s.api().answer({ session_id: null, phase: "idle" });
    assert.equal(s.draw(), null);
    // A failure ends it as well, and the voice that waited for it is not asked for.
    await s.api().start(OPENAI, { device: null, share: false });
    s.api().answer({ session_id: 3, phase: "connecting" });
    s.api().updateStatus({ session_id: 3, phase: "failed", error: "talk_unreachable" });
    assert.equal(s.draw(), null);
    assert.equal(s.asked(talkView.AUDIO).length, 1, "only the first conversation's voice");
});

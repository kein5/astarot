// A typed message through the core: it is translated once, sent to VRChat's chatbox once over OSC
// with its translation, and read aloud once. The sending part of tests/platform/
// test_native_quick_chat.py (the Quick Chat window and its shortcut stay with the E2E tests).
import { expect, test } from "./fixtures";
import { OpenAiCompatible, OscReceiver, SpeechServer } from "./standIns";

const MESSAGE = "こんにちは、結合テストです";
const TRANSLATION = "Hello, this is the integration test";

test("a typed message is translated, sent to the chatbox and read aloud once each", async ({ app }) => {
    const translation = await new OpenAiCompatible(null, TRANSLATION).start();
    const speech = await new SpeechServer().start();
    const osc = await new OscReceiver().start();
    try {
        const voice = app.settings().VOICE_SETTINGS as Record<string, unknown>;
        await app.restartWith({
            SELECTED_TRANSLATION_ENGINES: { 1: "LMStudio", 2: "LMStudio", 3: "LMStudio" },
            LMSTUDIO_URL: `${translation.url}/v1`,
            SEND_MESSAGE_TO_VRC: true, OSC_IP_ADDRESS: "127.0.0.1", OSC_PORT: osc.port,
            VOICE_SETTINGS: { ...voice, japanese_server: "external", japanese_url: speech.url },
        });
        const page = app.page;
        // What to read aloud is chosen on the speech settings page; each run starts with none.
        await app.openSettings("Text to speech (TTS)");
        await app.unfold(page.getByLabel("Chat voice"));
        await page.getByLabel("Chat voice").selectOption("original");
        // The stand-ins' one speaker (native/browser-core-bridge/src/services.rs).
        await page.getByLabel("Output device").selectOption({ label: "Integration speaker" });
        await page.getByRole("button", { name: "Save changes" }).click();
        await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
        await app.closeSettings();
        await app.setSwitch("Translation");
        await app.setSwitch("Text to speech (TTS)");

        const composer = page.locator("textarea[class*=message_box_input_area]");
        await composer.fill(MESSAGE);
        await composer.press("Enter");
        await expect(composer).toHaveValue("");

        // The log shows the message with its translation.
        const log = page.locator("#log_container");
        await expect(log).toContainText(MESSAGE);
        await expect(log).toContainText(TRANSLATION);

        // What left the app: one translation request for the message, one chatbox message that
        // carries the translation, and one speech request for the message.
        await expect.poll(() => translation.translations().length).toBe(1);
        expect(JSON.stringify(translation.translations()[0].body)).toContain(MESSAGE);
        await expect.poll(() => osc.chatbox().length).toBe(1);
        expect(String(osc.chatbox()[0].args[0])).toContain(TRANSLATION);
        await expect.poll(() => speech.speeches().length).toBe(1);
        expect((speech.speeches()[0].body as Record<string, unknown>).input).toBe(MESSAGE);

        // Nothing more arrives later.
        await page.waitForTimeout(1_000);
        expect([translation.translations().length, osc.chatbox().length, speech.speeches().length]).toEqual([1, 1, 1]);
    } finally {
        await Promise.all([translation.stop(), speech.stop(), osc.stop()]);
    }
});

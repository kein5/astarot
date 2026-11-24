// Settings saved on the settings pages reach the core, which writes them to config.json, and come
// back after the app quits and starts again on the same settings folder with a new core. The
// saving part of tests/platform/test_native_tts_settings.py, through the core.
import { expect, test } from "./fixtures";

const INSTRUCTION = "改行を含む\n保存の試験";
const MODEL = `/private/${"permitted-long-folder/".repeat(15)}voice.pth`;

test("speech and voice changer settings are saved by the core and come back after a restart", async ({ app }) => {
    const page = app.page;
    const voice = () => app.settings().VOICE_SETTINGS as Record<string, unknown>;

    // The Japanese speech settings (there is one group for Japanese and one for other languages).
    const japanese = page.getByLabel("Japanese TTS · Generation");
    await app.openSettings("Text to speech (TTS)");
    await app.unfold(japanese.getByLabel("Seed mode"));
    // A choice is saved at once, typed text when focus leaves the form (#1111).
    await japanese.getByLabel("Seed mode").selectOption("fixed");
    await expect.poll(() => voice().japanese_seed).toBe("0");
    await japanese.getByLabel("Instruction").fill(INSTRUCTION);
    await japanese.getByLabel("Instruction").blur();
    await expect.poll(() => voice().japanese_instructions).toBe(INSTRUCTION);

    await page.getByRole("button", { name: "Voice changer (RVC)", exact: true }).first().click();
    await app.unfold(page.getByLabel("Permitted RVC model (.pth)"));
    await page.getByLabel("Permitted RVC model (.pth)").fill(MODEL);
    await page.getByLabel("Permitted RVC model (.pth)").blur();

    // The core wrote them to the settings file.
    await expect.poll(() => (app.settings().DIRECT_VOICE_SETTINGS as Record<string, unknown>)?.rvc_model).toBe(MODEL);
    await expect.poll(() => voice().japanese_instructions).toBe(INSTRUCTION);
    expect(voice().japanese_seed).toBe("0");

    // The app quits (the core stops and saves) and starts again on the same folder.
    await app.restart();
    await app.openSettings("Text to speech (TTS)");
    await app.unfold(japanese.getByLabel("Instruction"));
    await expect(japanese.getByLabel("Instruction")).toHaveValue(INSTRUCTION);
    await expect(japanese.getByLabel("Seed mode")).toHaveValue("fixed");
    await expect(japanese.getByLabel("Seed value")).toHaveValue("0");
    await page.getByRole("button", { name: "Voice changer (RVC)", exact: true }).first().click();
    await app.unfold(page.getByLabel("Permitted RVC model (.pth)"));
    await expect(page.getByLabel("Permitted RVC model (.pth)")).toHaveValue(MODEL);
});

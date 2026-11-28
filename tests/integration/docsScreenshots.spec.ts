// Not a test: the user guide's screenshots (site/public/screenshots/<lang>/), taken from the app's
// screens on the real core (native/browser-core-bridge), with sample data the stand-ins cannot
// make: a conversation with another player, a VRChat found, the recent times of Inputs and
// outputs. It runs only when ASTAROT_DOCS_SCREENSHOTS names the folder to write to, in Chromium
// (tools/docs_screenshots.py). Nothing in the pictures comes from the PC that makes them: the
// core's devices and services are the stand-ins, and its folder is shown as a Linux install's.
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import type { App } from "./fixtures";
import { expect, test } from "./fixtures";

const OUTPUT = process.env.ASTAROT_DOCS_SCREENSHOTS ?? "";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VERSION: string = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const FLOW = JSON.parse(readFileSync(path.join(ROOT, "tests/voice/fixtures/io_flow_sample.json"), "utf8"));
// The core's host names itself 0.0.0; the pictures show the version being documented.
const HOST_VERSION = "0.0.0";
// The log stamps each row with the time it arrived; a fixed clock keeps the pictures the same.
const CLOCK = new Date(2026, 0, 10, 21, 30);
// The longest wait for animations before a picture is taken (save()).
const ANIMATION_WAIT_MS = 3000;
// Where a Linux install keeps its settings and downloads (site/*/guide/install.mdx).
const SETTINGS_FOLDER = "~/.config/astarot";

type Lang = "ja" | "en";
// File name -> the settings page, by the name its side menu button shows (locales side_menu_labels).
const PAGES: Record<string, Record<Lang, string>> = {
    device: { ja: "デバイス", en: "Device" },
    translation: { ja: "翻訳", en: "Translation" },
    transcription: { ja: "音声認識（ASR）", en: "Speech recognition (ASR)" },
    "chat-reading": { ja: "チャット読み取り（OCR）", en: "Chat reading (OCR)" },
    tts: { ja: "テキスト読み上げ（TTS）", en: "Text to speech (TTS)" },
    rvc: { ja: "ボイスチェンジャー（RVC）", en: "Voice changer (RVC)" },
    vr: { ja: "字幕とVR", en: "Captions and VR" },
    hotkeys: { ja: "ホットキー", en: "Hotkeys" },
    advanced: { ja: "高度な設定", en: "Advanced" },
};
// File name -> (settings page, the text to bring to the top of the picture).
const SECTIONS: Record<string, [string, Record<Lang, string>]> = {
    "asr-models": ["transcription", { ja: "ASR + VAD", en: "ASR + VAD" }],
    "desktop-captions": ["vr", { ja: "デスクトップの字幕オーバーレイ", en: "Desktop caption overlay" }],
    websocket: ["advanced", { ja: "WebSocket", en: "WebSocket" }],
};
const QUICK_SETTINGS: Record<Lang, string> = { ja: "クイック設定", en: "Quick settings" };
const FLOW_BUTTON: Record<Lang, string> = { ja: "入力と出力", en: "Inputs and outputs" };
const REVIEW: Record<Lang, string> = { ja: "取得内容を確認", en: "Review download" };
const FLOW_LATEST = "ありがとうございます。お願いします！";
// The last line of app/captionOverlay.tsx, to know its captions are drawn.
const CAPTION_SAMPLE = "Thank you. I'm looking forward to it!";
// "Your language" Japanese and the target English in both display languages, as the sample is.
const CONVERSATION: [string, string, string][] = [
    ["/run/transcription_send_mic_message", "こんばんは！このワールドは初めて来ました。", "Good evening! This is my first time in this world."],
    ["/run/transcription_receive_speaker_message", "Welcome! Let me show you around.", "ようこそ！案内しますね。"],
    ["/run/transcription_send_mic_message", "ありがとうございます。お願いします！", "Thank you. Yes, please!"],
];

/** A line to the page as the core would send it. */
async function line(page: Page, endpoint: string, result: unknown) {
    await page.evaluate(text => window.__coreLine?.(text), JSON.stringify({ status: 200, endpoint, result }));
}

/** Writes the picture, with the version and `replace`'s (shown text, text for the picture) pairs. */
async function save(page: Page, file: string, replace: [string, string][] = []) {
    // Let finite animations settle, but never wait past ANIMATION_WAIT_MS: an animation that is
    // paused, or restarted before it ends, never finishes.
    await page.evaluate(ms => Promise.race([
        Promise.all(document.getAnimations()
            .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
            .map(animation => animation.finished.catch(() => {}))),
        new Promise(resolve => setTimeout(resolve, ms)),
    ]), ANIMATION_WAIT_MS);
    await page.evaluate(pairs => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode())
            for (const [shown, wanted] of pairs)
                if (node.nodeValue?.includes(shown)) node.nodeValue = node.nodeValue.replaceAll(shown, wanted);
    }, [[HOST_VERSION, VERSION], ...replace]);
    await page.screenshot({ path: file });
}

/** Translation on, VRChat found, and a short conversation in the log. */
async function mainPageInUse(page: Page) {
    await line(page, "/get/data/vrchat_osc_presence", "found");
    await line(page, "/set/enable/translation", true);
    for (const [endpoint, original, translation] of CONVERSATION) {
        await line(page, endpoint, {
            original: { message: original, transliteration: [] },
            translations: [{ message: translation, transliteration: [] }],
        });
    }
    await page.getByText(CONVERSATION[CONVERSATION.length - 1][2], { exact: true }).waitFor();
}

/** Opens the folds around a heading and brings it to the top of the window. */
async function bringUp(app: App, text: string) {
    const heading = app.page.getByText(text, { exact: true }).first();
    await app.unfold(heading);
    await heading.evaluate(node => node.scrollIntoView({ block: "start" }));
    await app.page.waitForTimeout(300);
}

for (const lang of ["ja", "en"] as const) {
    test.describe(`screenshots in ${lang}`, () => {
        test.skip(({ browserName }) => !OUTPUT || browserName !== "chromium", "writes the guide's screenshots; run tools/docs_screenshots.py");
        test.use({
            viewport: { width: 1200, height: 850 },
            // Every use picked, as after an update: the pictures show every switch and settings page.
            // The devices follow the system's, as a new install's do; the stand-ins list none.
            settings: { UI_LANGUAGE: lang, USAGE_PRESETS: ["all"], SEND_MESSAGE_TO_VRC: true, AUTO_MIC_SELECT: true, AUTO_SPEAKER_SELECT: true },
        });

        test(`the guide's pictures (${lang})`, async ({ app, page }) => {
            test.setTimeout(240_000);
            const out = path.join(OUTPUT, lang);
            mkdirSync(out, { recursive: true });
            const picture = (name: string) => path.join(out, `${name}.png`);
            // The app's version, and a desktop that can draw the caption window (Windows).
            await page.addInitScript(version => {
                window.__integrationAnswers = {
                    caption_overlay_supported: true,
                    "plugin:app|version": version,
                    app_update_info: { kind: "development", mode: "disabled", channel: "stable", current_version: version, package_manager: null },
                };
            }, VERSION);
            await page.clock.setFixedTime(CLOCK);
            await app.restart();

            await mainPageInUse(page);
            await save(page, picture("main"));

            await page.getByRole("button", { name: QUICK_SETTINGS[lang] }).click();
            await page.waitForTimeout(600);
            await save(page, picture("quick-settings"));
            await page.keyboard.press("Escape");

            // Inputs and outputs, with the sample route and recent times.
            await page.getByRole("button", { name: FLOW_BUTTON[lang], exact: true }).click();
            await line(page, "/get/data/io_flow", FLOW.flow);
            for (const trace of FLOW.traces) await line(page, "/run/io_trace", trace);
            await page.getByText(FLOW_LATEST, { exact: false }).first().waitFor();
            await page.waitForTimeout(300);
            await save(page, picture("io-flow"));
            await page.getByRole("button", { name: FLOW_BUTTON[lang], exact: true }).click();

            await page.locator("[data-open-settings]").click();
            for (const [name, labels] of Object.entries(PAGES)) {
                await page.getByRole("button", { name: labels[lang], exact: true }).first().click();
                await page.waitForTimeout(400);
                // The core's host has no OCR engine (native/browser-core-bridge); the app has one.
                // The page shows chat reading ready, as after its model is downloaded.
                if (name === "chat-reading") {
                    await line(page, "/get/data/ocr_readiness", { engine: true, language_supported: true, missing_models: [] });
                    await page.waitForTimeout(200);
                }
                await save(page, picture(name));
            }
            for (const [name, [parent, labels]] of Object.entries(SECTIONS)) {
                await page.getByRole("button", { name: PAGES[parent][lang], exact: true }).first().click();
                await page.waitForTimeout(300);
                await bringUp(app, labels[lang]);
                await save(page, picture(name));
            }

            // The download review of a speech model. It names the folder it saves to, which is
            // this run's own; the picture shows the folder a Linux install uses instead.
            // The catalog's groups start closed (#841): the first group of the speech models is opened.
            await page.getByRole("button", { name: PAGES.tts[lang], exact: true }).first().click();
            const group = page.locator("section[class*=catalog_group]").first();
            await app.unfold(group);
            const fold = group.locator("details").first();
            if (!(await fold.evaluate(element => (element as HTMLDetailsElement).open))) await fold.locator(":scope > summary").click();
            // The button names its model after its words (#1254): "Review download (…)".
            await group.getByRole("button", { name: new RegExp(`^${REVIEW[lang]}[（(]`) }).first().click();
            const dialog = page.getByRole("dialog");
            await dialog.waitFor();
            await page.waitForTimeout(300);
            const replace: [string, string][] = [[app.state, SETTINGS_FOLDER], [app.state.replaceAll("\\", "/"), SETTINGS_FOLDER]];
            await save(page, picture("model-consent"), replace);
            await page.keyboard.press("Escape");

            // The notice before anything is sent, as at the first start. The core's host never
            // sends usage events, so it never asks; the page is told the notice is pending.
            await app.restart();
            await line(page, "/get/data/telemetry_notice", { pending: true });
            await page.getByRole("dialog").first().waitFor();
            await page.waitForTimeout(300);
            await save(page, picture("telemetry-notice"));

            // The desktop captions over a stand-in scene, then with the flow strip.
            await page.goto(`/caption-overlay.html?lang=${lang}`);
            await page.getByText(CAPTION_SAMPLE, { exact: true }).waitFor();
            await save(page, picture("captions-on-screen"));
            await page.goto(`/caption-overlay.html?flow=1&lang=${lang}`);
            await page.getByText(CAPTION_SAMPLE, { exact: true }).waitFor();
            await page.getByText(FLOW_LATEST, { exact: false }).first().waitFor();
            await save(page, picture("flow-on-screen"));

            // The VR panel's Inputs and outputs window at its real size.
            await page.setViewportSize({ width: 720, height: 640 });
            await page.goto(`/vr-flow.html?lang=${lang}`);
            await page.getByText(FLOW.traces[FLOW.traces.length - 1].text, { exact: false }).first().waitFor();
            await page.waitForTimeout(300);
            await save(page, picture("vr-io-flow"));
            await expect(page.locator("#root")).toBeVisible();
        });
    });
}

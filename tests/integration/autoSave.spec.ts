// #1111: a setting that saves by itself, through the core. The chat reading page's window name is
// saved when focus leaves the field, without the save bar; an empty name is refused in words under
// the field and never sent; Escape puts the saved name back.
import { expect, test } from "./fixtures";

test("the window name saves when focus leaves it, and an empty one is refused under the field", async ({ app }) => {
    const page = app.page;
    await app.openSettings("Chat reading (OCR)");
    const field = page.getByLabel("Window name", { exact: true });
    await app.unfold(field);
    const saved = app.settings().OCR_WINDOW_TITLE ?? "VRChat";

    // An empty name: said under the field, the field marked, and nothing written.
    await field.fill("");
    await field.press("Tab");
    const problem = page.getByRole("alert").filter({ hasText: "The window name is empty." });
    await expect(problem).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    expect(app.settings().OCR_WINDOW_TITLE ?? "VRChat").toBe(saved);

    // A name: the problem goes as soon as the field is edited, and leaving the field saves it.
    await field.fill("VRChat Beta");
    await expect(problem).toHaveCount(0);
    await field.press("Tab");
    await expect.poll(() => app.settings().OCR_WINDOW_TITLE).toBe("VRChat Beta");
    // The page has nothing left for the save bar: it says its changes apply at once.
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);

    // Escape puts the saved name back without saving the edit.
    await field.fill("Other client");
    await field.press("Escape");
    await expect(field).toHaveValue("VRChat Beta");
    await field.press("Tab");
    expect(app.settings().OCR_WINDOW_TITLE).toBe("VRChat Beta");
});

// #1111: the refusal of a field's own save, said by the core, is said under the field in the words
// of its old notice, and the notice is not shown as well. The value the core keeps stays saved.
test("a server address the core refuses is said under the field, without a notice as well", async ({ app }) => {
    const page = app.page;
    await page.evaluate(() => {
        const seen: string[] = [];
        document.documentElement.dataset.seenToasts = "[]";
        new MutationObserver(() => {
            for (const toast of document.querySelectorAll(".Toastify__toast")) {
                const text = toast.textContent?.trim();
                if (text && !seen.includes(text)) seen.push(text);
            }
            document.documentElement.dataset.seenToasts = JSON.stringify(seen);
        }).observe(document.body, { childList: true, subtree: true });
    });
    await app.openSettings("Translation");
    const field = page.getByLabel("LM Studio URL", { exact: true });
    await app.unfold(field);
    const saved = app.settings().LMSTUDIO_URL ?? "http://127.0.0.1:1234/v1";

    // Not an address at all: the field's own check says what would do.
    await field.fill("127.0.0.1:1234");
    await field.press("Tab");
    await expect(page.getByRole("alert").filter({ hasText: "starting with http:// or https://" })).toBeVisible();

    // An address where no server answers: the core refuses it, and its reason is under the field.
    await field.fill("http://127.0.0.1:9/v1");
    await field.press("Tab");
    const refusal = page.getByRole("alert").filter({ hasText: "the server could not be reached" });
    await expect(refusal).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    expect(app.settings().LMSTUDIO_URL ?? "http://127.0.0.1:1234/v1").toBe(saved);
    // SnackbarController waits 100 ms before opening a toast; give it time to fire if it were going to.
    await page.waitForTimeout(250);
    const toasts = await page.evaluate(() => JSON.parse(document.documentElement.dataset.seenToasts ?? "[]") as string[]);
    expect(toasts.filter(text => text.includes("could not be reached"))).toEqual([]);
});

// #1111: the advanced settings save by themselves. A number out of range is refused by the field's
// own check; a host the core refuses is said under the field; the certificate and key save as one
// pair when focus leaves both (decided 3), and one path without the other is refused under the pair.
test("the advanced settings save by themselves, and the certificate and key save as a pair", async ({ app }) => {
    const page = app.page;
    await app.openSettings("Advanced");

    // A number out of range: the field says the range, and nothing is written.
    const fontSize = page.getByLabel("Font size (px)", { exact: true });
    await app.unfold(fontSize);
    const savedSize = app.settings().OBS_BROWSER_SOURCE_FONT_SIZE;
    await fontSize.fill("300");
    await fontSize.press("Tab");
    await expect(page.getByRole("alert").filter({ hasText: "Enter a whole number from 10 to 200." })).toBeVisible();
    expect(app.settings().OBS_BROWSER_SOURCE_FONT_SIZE).toBe(savedSize);
    await fontSize.fill("48");
    await fontSize.press("Tab");
    await expect.poll(() => app.settings().OBS_BROWSER_SOURCE_FONT_SIZE).toBe(48);

    // A LAN address without a certificate: the core refuses it, and says so under the field.
    const host = page.getByLabel("WebSocket host (IPv4)", { exact: true });
    await app.unfold(host);
    const savedHost = String(app.settings().WEBSOCKET_HOST ?? "127.0.0.1");
    await host.fill("192.0.2.10");
    await host.press("Tab");
    await expect(page.getByRole("alert").filter({ hasText: "needs a certificate and key" })).toBeVisible();
    await expect(host).toHaveAttribute("aria-invalid", "true");
    expect(app.settings().WEBSOCKET_HOST ?? "127.0.0.1").toBe(savedHost);
    await host.press("Escape");
    await expect(host).toHaveValue(savedHost);

    // The pair: moving from the certificate to the key saves nothing; leaving the pair with one path
    // is refused under it; a pair the core cannot load is refused by the core.
    const cert = page.getByLabel("Certificate file", { exact: true });
    const key = page.getByLabel("Private key file", { exact: true });
    await app.unfold(cert);
    await cert.fill("/nonexistent/vox-cert.pem");
    await cert.press("Tab");
    await expect(key).toBeFocused();
    await expect(page.getByRole("alert").filter({ hasText: "Enter both the certificate and the private key" })).toHaveCount(0);
    await key.press("Tab");
    await expect(page.getByRole("alert").filter({ hasText: "Enter both the certificate and the private key" })).toBeVisible();
    expect(app.settings().WEBSOCKET_TLS_CERT_FILE ?? "").toBe("");
    await key.fill("/nonexistent/vox-key.pem");
    await key.press("Tab");
    await expect(page.getByRole("alert").filter({ hasText: "This certificate and key cannot be used." })).toBeVisible();
    expect(app.settings().WEBSOCKET_TLS_CERT_FILE ?? "").toBe("");
    // The page has nothing left for the save bar.
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
});

// #1111: the forms save by themselves too. A word added to the filter and a choice in the realtime
// captions are saved at once; the captions' address when focus leaves the form. Nothing waits for
// a Save button.
test("the word filter and the realtime captions save by themselves", async ({ app }) => {
    const page = app.page;
    await app.openSettings("Speech recognition (ASR)");

    // A word added to the filter is saved at once.
    const word = page.locator('input[aria-label="Mic word filter"]');
    await app.unfold(word);
    await word.fill("VRChat");
    await word.press("Enter");
    await expect.poll(() => app.settings().MIC_WORD_FILTER).toEqual(["VRChat"]);

    // A choice in the realtime captions is saved at once.
    const silence = page.getByLabel("Silence that ends an utterance", { exact: true });
    await app.unfold(silence);
    await silence.selectOption({ label: "0.3 s" });
    await expect.poll(() => (app.settings().REALTIME_ASR_SETTINGS as Record<string, unknown>)?.silence_duration_ms).toBe(300);

    // The address is saved when focus leaves the form, and the form has no Save button.
    const address = page.getByLabel("ASR server URL", { exact: true });
    await address.fill("http://127.0.0.1:8178");
    await expect(page.getByRole("button", { name: "Save caption settings" })).toHaveCount(0);
    await address.press("Enter");
    await expect.poll(() => (app.settings().REALTIME_ASR_SETTINGS as Record<string, unknown>)?.base_url).toBe("http://127.0.0.1:8178");
});

// #1111: the voice forms save by themselves. On the text to speech page a choice is saved at once
// and a typed address on Enter; the page has nothing left for the save bar.
test("the text to speech settings save by themselves", async ({ app }) => {
    const page = app.page;
    const voice = () => app.settings().VOICE_SETTINGS as Record<string, unknown>;
    await app.openSettings("Text to speech (TTS)");
    const mode = page.getByLabel("Chat voice", { exact: true });
    await app.unfold(mode);
    // Speech needs somewhere to play: the stand-ins' one speaker first (native/browser-core-bridge/src/services.rs).
    await page.getByLabel("Output device", { exact: true }).selectOption({ label: "Integration speaker" });
    await expect.poll(() => voice().output_device).toBeTruthy();
    await mode.selectOption("original");
    await expect.poll(() => voice().mode).toBe("original");
    const server = page.getByLabel("Japanese server", { exact: true });
    await server.selectOption("external");
    await expect.poll(() => voice().japanese_server).toBe("external");
    const address = page.getByLabel("Japanese server URL (Irodori-TTS)", { exact: true });
    await address.fill("http://127.0.0.1:8189");
    await address.press("Enter");
    await expect.poll(() => voice().japanese_url).toBe("http://127.0.0.1:8189");
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(page.getByText("Changes on this page apply at once")).toBeVisible();
});

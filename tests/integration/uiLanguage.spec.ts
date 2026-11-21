import { expect, test } from "./fixtures";

// #904: a new UI language draws the pages that are open in it; it does not draw them again from the
// start. The VR panel's settings window can set the language while the main window shows any page.
test.use({ settings: { UI_LANGUAGE: "en", OVERLAY_VR_PANEL: true, MIC_AUTOMATIC_THRESHOLD: true, SPEAKER_AUTOMATIC_THRESHOLD: true } });

test("a UI language set from the VR panel's settings says the open settings page in it", async ({ app }) => {
    const page = app.page;
    await app.openSettings("Device");
    await app.unfold(page.locator("input[aria-label='Mic sensitivity']"));
    await expect(page.getByRole("textbox", { name: "Mic sensitivity", exact: true })).toHaveValue("Auto");
    await expect(page.getByRole("textbox", { name: "Speaker sensitivity", exact: true })).toHaveValue("Auto");

    // What the VR panel sends: its settings window opens, and the language is set there.
    await app.emit("vr-panel-config-page", true);
    await app.emit("vr-panel-stdout", { path: "/set/data/ui_language", value: "ja" });
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect.poll(() => app.settings().UI_LANGUAGE).toBe("ja");

    // The automatic thresholds are said in the new language, on the page that stayed as it was:
    // the same page, with its fold still open.
    await expect(page.getByRole("button", { name: "デバイス", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("textbox", { name: "マイクの入力感度", exact: true })).toHaveValue("自動");
    await expect(page.getByRole("textbox", { name: "スピーカーの入力感度", exact: true })).toHaveValue("自動");
});

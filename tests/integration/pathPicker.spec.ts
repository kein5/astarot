import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "./fixtures";

// #1231: a path field has a button beside it that picks the path. The shell's picker is a stand-in
// here (app/tauriStandIns.ts): it answers with the path a test gives, or null as a cancel.
test("a path field's button fills it with the picked folder or file, and a cancel changes nothing", async ({ app }) => {
    const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "astarot-pick-runtime-"));
    try {
        await app.openSettings("Voice changer (RVC)");
        // The setup fold, opened unless it already is (it starts open while its setup is missing).
        const setup = app.page.locator("details[data-setup]", { has: app.page.locator(":scope > summary", { hasText: "Models and runtime" }) }).first();
        if (!(await setup.evaluate(node => (node as HTMLDetailsElement).open))) await setup.locator(":scope > summary").click();
        // The paths of one's own files are in the fold after the downloads (#1266 ★5).
        await setup.locator('details[data-own-model="rvc"] > summary').click();
        const runtime = app.page.getByLabel("RVC runtime folder", { exact: true });
        const model = app.page.getByLabel("Permitted RVC model (.pth)", { exact: true });
        await expect(runtime).toHaveValue("");

        // A folder: the picked folder goes into the field as typed.
        await app.page.evaluate(dir => {
            window.__integrationAnswers = { ...(window.__integrationAnswers ?? {}), pick_folder: dir };
        }, runtimeDir);
        await app.page.getByRole("button", { name: 'Choose folder for "RVC runtime folder"' }).click();
        await expect(runtime).toHaveValue(runtimeDir);

        // A file: the picked file goes into the field; the button sits at the field's right.
        const picked = path.join(runtimeDir, "voice.pth");
        await app.page.evaluate(file => {
            window.__integrationAnswers = { ...(window.__integrationAnswers ?? {}), pick_file: file };
        }, picked);
        const choose = app.page.getByRole("button", { name: 'Choose file for "Permitted RVC model (.pth)"' });
        await choose.click();
        await expect(model).toHaveValue(picked);
        const [field, button] = await Promise.all([model.boundingBox(), choose.boundingBox()]);
        expect(field && button && button.x >= field.x + field.width).toBe(true);

        // A cancel: nothing changes.
        await app.page.evaluate(() => {
            window.__integrationAnswers = { ...(window.__integrationAnswers ?? {}), pick_file: null };
        });
        await choose.click();
        await expect(model).toHaveValue(picked);
        await expect(app.page.getByRole("alert").filter({ hasText: "file picker" })).toHaveCount(0);
    } finally {
        rmSync(runtimeDir, { recursive: true, force: true });
    }
});

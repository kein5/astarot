import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "./fixtures";

// #1096, #1115, #1118: Config file location shows the read-only config.json path with open-folder,
// while Conversation log destination supports folder picking, direct path editing, reset to default,
// auto-save without the save bar (#1111), and inline validation on invalid paths.
test("config file location displays the path and conversation log destination auto-saves, validates, picks, and resets", async ({ app }) => {
    const customDir = mkdtempSync(path.join(os.tmpdir(), "astarot-log-dest-"));
    const pickedDir = mkdtempSync(path.join(os.tmpdir(), "astarot-log-pick-"));
    try {
        await app.openSettings("Advanced");

        // Config file location shows the real config.json path (read-only) with open-folder action.
        const configRow = app.page.locator('[data-setting-id="config_file_destination"]');
        await expect(configRow).toContainText(path.join(app.state, "config.json"));
        await expect(configRow.getByRole("button", { name: "Open config file folder" })).toBeVisible();

        // Conversation log destination starts on the default logs folder with no error.
        const logRow = app.page.locator('[data-setting-id="message_logs_destination"]');
        const input = logRow.locator('input[data-slot="input"]');
        const defaultLogs = path.join(app.state, "logs");
        await expect(input).toHaveValue(defaultLogs);
        await expect(logRow.getByRole("alert")).toHaveCount(0);

        // Relative path is rejected inline without hitting the backend or touching the save bar.
        await input.fill("relative/logs");
        await input.press("Enter");
        await expect(logRow.getByRole("alert")).toContainText("Relative paths cannot be used");
        await expect(input).toHaveAttribute("aria-invalid", "true");

        // Missing absolute path is rejected by the Rust core with inline error.
        const missingDir = path.join(customDir, "does-not-exist");
        await input.fill(missingDir);
        await input.press("Enter");
        await expect(logRow.getByRole("alert")).toContainText("does not exist");

        // Valid absolute path auto-saves immediately on Enter (no save bar needed).
        await input.fill(customDir);
        await input.press("Enter");
        await expect(logRow.getByRole("alert")).toHaveCount(0);
        await expect(input).toHaveValue(customDir);
        await expect.poll(() => app.settings().CONVERSATION_LOG_DIRECTORY).toBe(customDir);

        // Folder picker auto-saves the picked folder immediately.
        await app.page.evaluate(dir => {
            window.__integrationAnswers = { ...(window.__integrationAnswers ?? {}), pick_folder: dir };
        }, pickedDir);
        await logRow.getByRole("button", { name: "Choose folder" }).click();
        await expect(input).toHaveValue(pickedDir);
        await expect.poll(() => app.settings().CONVERSATION_LOG_DIRECTORY).toBe(pickedDir);

        // Reset to default clears the custom folder and returns to the default logs directory.
        await logRow.getByRole("button", { name: "Reset to default" }).click();
        await expect(input).toHaveValue(defaultLogs);
        await expect(logRow.getByRole("alert")).toHaveCount(0);
        await expect.poll(() => app.settings().CONVERSATION_LOG_DIRECTORY ?? null).toBe(null);
    } finally {
        rmSync(customDir, { recursive: true, force: true });
        rmSync(pickedDir, { recursive: true, force: true });
    }
});

import { invoke } from "@tauri-apps/api/core";
import type { LogDirectoryState } from "./config_page_setter/settingTypes.ts";

// Error codes returned by /get/data/path_logs and /set/data/path_logs (docs/spec/ipc-protocol.md),
// plus the shell folder picker failure.
export const LOG_DIRECTORY_ERROR_CODES = [
    "log_directory_invalid",
    "log_directory_not_absolute",
    "log_directory_missing",
    "log_directory_not_directory",
    "log_directory_unwritable",
    "folder_picker_unavailable",
] as const;

export type LogDirectoryErrorCode = (typeof LOG_DIRECTORY_ERROR_CODES)[number];

const KNOWN_ERROR_CODES = new Set<string>(LOG_DIRECTORY_ERROR_CODES);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

// Accepts Unix absolute paths (/...), Windows drive paths (C:\... or C:/...), and UNC paths (\\host\share).
export const isAbsolutePath = (value: string): boolean =>
    value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value);

export type LogDirectoryValidation =
    | { ok: true; path: string }
    | { ok: false; error_code: "log_directory_invalid" | "log_directory_not_absolute" };

// Checks path syntax before sending to /set/data/path_logs so obvious typos or relative paths
// never trigger a backend reset of a previously saved custom folder (#1096, #1111, #1115).
export const validateLogDirectoryInput = (raw: string): LogDirectoryValidation => {
    const trimmed = raw.trim();
    if (trimmed === "") return { ok: false, error_code: "log_directory_invalid" };
    if (!isAbsolutePath(trimmed)) return { ok: false, error_code: "log_directory_not_absolute" };
    return { ok: true, path: trimmed };
};

export const normalizeLogDirectoryState = (value: unknown): LogDirectoryState | null => {
    if (!isRecord(value) || typeof value.path !== "string") return null;
    if (value.error_code !== null && typeof value.error_code !== "string") return null;
    return { path: value.path, error_code: value.error_code };
};

export const logDirectoryErrorKey = (code: string): string => {
    const normalized: LogDirectoryErrorCode = KNOWN_ERROR_CODES.has(code)
        ? (code as LogDirectoryErrorCode)
        : "log_directory_invalid";
    return `config_page.others.auto_export_message_logs.errors.${normalized}`;
};

export type PickFolderResult =
    | { ok: true; path: string | null }
    | { ok: false; error_code: "folder_picker_unavailable" };

export const pickLogDirectory = async (initialPath: string | null, title: string): Promise<PickFolderResult> => {
    try {
        const selected = await invoke<string | null>("pick_folder", {
            initialPath: initialPath?.trim() ? initialPath : null,
            title,
        });
        return { ok: true, path: typeof selected === "string" && selected.trim() ? selected : null };
    } catch {
        return { ok: false, error_code: "folder_picker_unavailable" };
    }
};

import { invoke } from "@tauri-apps/api/core";

// The system's file and folder pickers for a path field (#1231), through the shell's commands
// pick_file and pick_folder (src-tauri/src/path_picker.rs).

// What a path field takes: a folder, or a file, of the kinds its extensions name when it names
// them (without the dot: "gguf").
export type PathPick =
    | { readonly kind: "folder" }
    | { readonly kind: "file"; readonly extensions?: readonly string[] };

export type PickedPath =
    | { ok: true; path: string | null }
    | { ok: false; error_code: "file_picker_unavailable" | "folder_picker_unavailable" };

// The patterns of the kinds of file, as the picker's list of kinds shows them: "*.pth, *.index".
export const filePatterns = (extensions: readonly string[]): string =>
    extensions.map(extension => `*.${extension}`).join(", ");

// Opens the picker in the folder of the field's path, if any. A picked path comes back as the
// system gives it; a cancel comes back as null and the field keeps its value. The picker that
// cannot open says so, and the field stays the way to enter the path.
export const pickPath = async (pick: PathPick, current: string | null, title: string, filterName: string): Promise<PickedPath> => {
    const initialPath = current?.trim() ? current.trim() : null;
    const extensions = pick.kind === "file" ? (pick.extensions ?? []).filter(extension => extension.length > 0) : [];
    try {
        const selected = pick.kind === "folder"
            ? await invoke<string | null>("pick_folder", { initialPath, title })
            : await invoke<string | null>("pick_file", {
                initialPath, title,
                filters: extensions.length > 0 ? [{ name: filterName, extensions: [...extensions] }] : null,
            });
        return { ok: true, path: typeof selected === "string" && selected.trim() ? selected : null };
    } catch {
        return { ok: false, error_code: pick.kind === "folder" ? "folder_picker_unavailable" : "file_picker_unavailable" };
    }
};

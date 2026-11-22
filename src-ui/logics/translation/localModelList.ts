// The model list of the local translation in Settings → Translation (#565). It lists only what
// the user can use or get: the models on the user's PC (downloaded built-in ones and their own)
// and the built-in models the download catalog offers. A built-in model the catalog does not
// offer has nothing to do there, except the selected one: the line above the list names it,
// so it stays, marked as one that cannot be downloaded yet.
import { downloadProgress, translationDownloadable, type TranslationCatalog } from "../main/setupNeeds.ts";
import { isUsersWeight } from "./translationCatalog.ts";

// A row of the weight list (CTranslate2WeightTypeStatus), as far as it is read here.
export interface LocalWeight {
    id: string;
    is_downloaded?: unknown;
    is_custom?: unknown;
    is_pending?: unknown;
    progress?: unknown;
}

export interface LocalModelList<T extends LocalWeight> {
    // The rows to show, in the order given. `download_unavailable` marks a built-in row the
    // catalog does not offer: no download button, and a word that says so.
    rows: (T & { download_unavailable?: true })[];
    // The catalog offers no built-in model and the selected one cannot be used: the local
    // translation has nothing to translate with, and another engine is the way forward.
    unavailable: boolean;
}

const usersModel = (row: LocalWeight): boolean => row.is_custom === true || isUsersWeight(row.id);

export function localModelList<T extends LocalWeight>(rows: readonly T[] | null | undefined, selected: unknown,
    catalog: TranslationCatalog | null | undefined): LocalModelList<T> {
    const all = rows ?? [];
    // null while the catalog is unknown: such a row is not listed yet, and not marked either.
    const offered = (row: T): boolean | null => usersModel(row) ? null : translationDownloadable(catalog, row.id);
    const listed = all.filter(row => usersModel(row) || row.is_downloaded === true || row.id === selected
        || offered(row) === true || downloadProgress(row) !== null);
    const marked = listed.map(row => offered(row) === false ? { ...row, download_unavailable: true as const } : row);
    const usable = all.some(row => row.id === selected && row.is_downloaded === true);
    const anyOffered = all.some(row => offered(row) === true);
    return { rows: marked, unavailable: !!catalog && !anyOffered && !usable };
}

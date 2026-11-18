// What a user acknowledges one by one, apart from the general consent, before a catalog model
// downloads (#411). The catalog row's `restrictions` comes from the model's license
// (native/ops/src/downloads/catalog.rs `license_restrictions`): `non_commercial` for a Creative
// Commons NonCommercial license such as NLLB-200's CC-BY-NC-4.0. The start request names every
// one in `acknowledged`; the backend refuses the download without them
// (`model_download_restriction_unacknowledged`). A model without restrictions sends the same
// request as before.
export type Restriction = "non_commercial";

// The kinds the dialog has words for (model_downloads.restriction.<kind> in locales/).
export const RESTRICTIONS: readonly Restriction[] = ["non_commercial"];

export type RestrictedModel = { id: string; catalog_version: string; restrictions?: unknown };

export type StartRequest = { id: string; consent: true; catalog_version: string; acknowledged?: Restriction[] };

// The row's restrictions the dialog can show. An unknown kind is kept, so that it is listed and
// keeps the download from starting rather than being dropped unseen.
export function restrictionsOf(model: { restrictions?: unknown } | null | undefined): string[] {
    const listed: unknown = model?.restrictions;
    const kinds: unknown[] = Array.isArray(listed) ? listed : [];
    return [...new Set(kinds.filter((kind): kind is string => typeof kind === "string"))];
}

// Whether the review may start: the consent, and each restriction ticked. A kind the UI has no
// words for cannot be acknowledged.
export function canStart(model: { restrictions?: unknown }, consent: boolean, acknowledged: readonly string[]): boolean {
    return consent && restrictionsOf(model).every(kind => (RESTRICTIONS as readonly string[]).includes(kind) && acknowledged.includes(kind));
}

// The body of /run/start_model_download for the model shown in the review, with the catalog
// version the user saw and the restrictions the user ticked. A model without restrictions
// sends no `acknowledged`.
export function startRequest(model: RestrictedModel, acknowledged: readonly string[] = []): StartRequest {
    const restrictions = restrictionsOf(model);
    const request: StartRequest = { id: model.id, consent: true, catalog_version: model.catalog_version };
    if (!restrictions.length) return request;
    return { ...request, acknowledged: restrictions.filter(kind => acknowledged.includes(kind)) as Restriction[] };
}

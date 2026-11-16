// Opt-in rules for CTranslate2 weights with a non-commercial license
// (NLLB, CC-BY-NC-4.0). Kept free of React/aliases so node --test can load it.
// The backend enforces the same rule (Controller._ctranslate2LicenseConsentError).

// A row of the CTranslate2 weight list, as far as these rules read it.
export type Ctranslate2Weight = { id: string; non_commercial?: boolean };

// The value sent to /set/data/selected_ctranslate2_weight_type: a bare id, or the id
// with the opt-in for a non-commercial license.
export type WeightRequest = string | { weight_type: string; accept_non_commercial_license: true };

export const isNonCommercialWeight = (weight: { non_commercial?: unknown } | null | undefined): weight is { non_commercial: true } =>
    weight?.non_commercial === true;

// The weight that is already selected never asks again: it was either
// confirmed before or saved by an older version, and the backend accepts it
// without the opt-in flag too. This never grants download consent.
export const needsLicenseConfirmation = (weight: Ctranslate2Weight | null | undefined, selected_id: unknown): boolean =>
    isNonCommercialWeight(weight) && weight.id !== selected_id;

// Payload for /set/data/selected_ctranslate2_weight_type only.
// Acquisitions use legacyDownloadRequest. A bare id keeps the payload for
// everything that doesn't need the opt-in.
export const weightRequest = (id: string, accepted = false): WeightRequest =>
    accepted ? { weight_type: id, accept_non_commercial_license: true } : id;

export const weightIdOfRequest = (request: WeightRequest | null | undefined): string | null | undefined =>
    (request !== null && typeof request === "object") ? request.weight_type : request;

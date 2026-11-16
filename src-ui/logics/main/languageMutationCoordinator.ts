export const LANGUAGE_MUTATION_ENDPOINTS: readonly string[] = [
    "/set/data/selected_tab_no",
    "/set/data/selected_your_languages",
    "/set/data/selected_target_languages",
    "/set/data/selected_translation_engines",
    "/run/swap_your_language_and_target_language",
];

// A language write from the main window ("pc") or the VR panel ("vr").
export interface LanguageMutationRequest {
    requestId: string;
    source: string;
    endpoint: string;
    expectedSnapshot?: unknown;
}

export type LanguageMutationInFlight = LanguageMutationRequest & { kind: "saving" | "unconfirmed" };

export interface LanguageMutationOutcome {
    reason?: string;
    status?: number;
}

export interface LanguageMutationResult extends LanguageMutationOutcome {
    requestId: string;
    endpoint: string;
    kind: "rejected" | "success" | "failure" | "unconfirmed";
}

export interface LanguageMutationState {
    inFlight: LanguageMutationInFlight | null;
    lastVrResult: LanguageMutationResult | null;
}

export interface LanguageMutationResponse {
    endpoint: string;
    status: number;
}

export interface LanguageMutationCoordinator {
    getState: () => LanguageMutationState;
    reject: (request: LanguageMutationRequest, reason: string) => void;
    begin: (request: LanguageMutationRequest, snapshot: unknown) => boolean;
    complete: (response: LanguageMutationResponse) => LanguageMutationInFlight | null;
    failBeforeSend: (requestId: string, reason: string) => LanguageMutationInFlight | null;
    markUnconfirmed: (requestId: string, reason: string) => boolean;
    reset: () => void;
}

export const isLanguageMutation = (endpoint: string): boolean => LANGUAGE_MUTATION_ENDPOINTS.includes(endpoint);

// キーの順に左右されない文字列にする。VR画面からの要求は Tauri の emit を通るとキーが辞書順に並び替わる
// (serde_json の Value は順序を保たない) ため、JSON.stringify の素の比較では内容が同じでも食い違う
const canonical = (value: unknown): string => JSON.stringify(value, (_key: string, v: unknown): unknown =>
    v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.keys(v).sort().map(key => [key, (v as Record<string, unknown>)[key]]))
        : v);
export const sameSnapshot = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

// The backend has no request IDs. Admit only one language write across PC and VR,
// and retain its ownership until a final response, even after a timeout.
export function createLanguageMutationCoordinator(
    publish: (state: LanguageMutationState) => void,
    onReject: (request: LanguageMutationRequest, reason: string) => void = () => {},
): LanguageMutationCoordinator {
    let state: LanguageMutationState = { inFlight: null, lastVrResult: null };
    const result = (request: LanguageMutationRequest, kind: LanguageMutationResult["kind"], extra: LanguageMutationOutcome = {}) => {
        if (request.source === "vr") {
            state = { ...state, lastVrResult: { requestId: request.requestId, endpoint: request.endpoint, kind, ...extra } };
        }
        publish(state);
    };
    return {
        getState: () => state,
        reject(request, reason) {
            // 実機で「言語を変えられなかった」原因を後から追えるよう、メイン画面のコンソールに理由を残す
            console.warn("[language] rejected", reason, request.endpoint, request.source);
            result(request, "rejected", { reason }); onReject(request, reason);
        },
        begin(request, snapshot) {
            if (!isLanguageMutation(request.endpoint)) return false;
            if (state.inFlight) { this.reject(request, "busy"); return false; }
            if (!sameSnapshot(request.expectedSnapshot, snapshot)) {
                this.reject(request, "stale"); return false;
            }
            state = { ...state, inFlight: { ...request, kind: "saving" } };
            publish(state);
            return true;
        },
        complete(response) {
            const request = state.inFlight;
            if (!request || response.endpoint !== request.endpoint || ![200, 400, 404, 423, 500].includes(response.status)) return null;
            state = { ...state, inFlight: null };
            if (response.status !== 200) console.warn("[language] failed", response.status, response.endpoint);
            result(request, response.status === 200 ? "success" : "failure", { status: response.status });
            return request;
        },
        failBeforeSend(requestId, reason) {
            const request = state.inFlight;
            if (!request || request.requestId !== requestId) return null;
            state = { ...state, inFlight: null };
            console.warn("[language] failed before send", reason, request.endpoint);
            result(request, "failure", { reason });
            return request;
        },
        markUnconfirmed(requestId, reason) {
            const request = state.inFlight;
            if (!request || request.requestId !== requestId) return false;
            state = { ...state, inFlight: { ...request, kind: "unconfirmed" } };
            result(request, "unconfirmed", { reason });
            return true;
        },
        reset() {
            const request = state.inFlight;
            state = { ...state, inFlight: null };
            if (request) result(request, "failure", { reason: "backend-restarted" });
            else publish(state);
        },
    };
}

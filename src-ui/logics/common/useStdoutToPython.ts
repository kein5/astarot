import { store } from "@store";
import { encode } from "js-base64";
import { useNotificationStatus } from "./useNotificationStatus";
import { useI18n } from "@useI18n";
import { pendingRequestRecovery, sendWithRecovery, type BackendResponse } from "./pendingRequestRecovery.ts";
import { expectBackendExit, undoExpectedExit, type ExpectedExitToken } from "./sidecarExitExpectation.ts";
import { settingsWriteResponses } from "./settingsWriteResponses.ts";
import { sendToMain } from "./vrPanelSend.ts";
import { isLanguageMutation, beginLanguageMutation, createLanguageRequestId, getLanguageSnapshot,
    failLanguageMutationBeforeSend, failLanguageRead, languageMutationWriteUnconfirmed } from "../main/languageMutations";
import type { LanguageMutationRequest } from "../main/languageMutationCoordinator.ts";

// One line to the backend (docs/spec/ipc-protocol.md): data is the value as base64 JSON.
interface BackendRequest {
    endpoint: string;
    data?: string;
    origin?: string;
}

// false when the request could not be sent. A settings write answers with its own response
// (settingsWriteResponses), or false when that never came.
export type StdoutResult = boolean | BackendResponse;

export type AsyncStdoutToPython = (path: string, value?: unknown,
    languageRequest?: Partial<LanguageMutationRequest>, origin?: string) => Promise<StdoutResult>;

export const useStdoutToPython = (): { asyncStdoutToPython: AsyncStdoutToPython } => {
    const { showNotification_Error } = useNotificationStatus();
    const { t } = useI18n();
    // origin: "vr_panel" when the main window relays a request of the VR panel. The backend
    // then checks the path against its own list too (src-python/models/vr_panel_policy.py).
    const asyncStdoutToPython: AsyncStdoutToPython = async (path, value = undefined, languageRequest = undefined, origin = undefined) => {
        const is_language_write = isLanguageMutation(path);
        const request: LanguageMutationRequest | undefined = is_language_write ? { ...languageRequest, endpoint: path,
            requestId: languageRequest?.requestId ?? createLanguageRequestId(),
            source: languageRequest?.source ?? (store.is_vr_panel ? "vr" : "pc"),
            expectedSnapshot: languageRequest?.expectedSnapshot ?? getLanguageSnapshot() } : undefined;
        const pendingVersion = pendingRequestRecovery.beginSend(path);
        let writeAttempted = false, languageRejected = false;
        const session = store.backend_session;
        const backend_subprocess = store.backend_subprocess;
        const settingsRequest = store.is_vr_panel ? null : settingsWriteResponses.begin(path);
        let exitToken: ExpectedExitToken | null = null;
        const sent = await sendWithRecovery(async () => {
            if (settingsRequest === false) return false;
            // The main window owns the sidecar and restores mirrored atoms on failure.
            if (store.is_vr_panel) {
                await sendToMain("vr-panel-stdout", { path, value, languageRequest: request });
                return true;
            }
            // request is set exactly for a language write.
            if (request && !beginLanguageMutation(request)) {
                languageRejected = true;
                return false;
            }
            const send_object: BackendRequest = { endpoint: path };
            if (value !== undefined) send_object.data = encode(JSON.stringify(value));
            if (origin !== undefined) send_object.origin = origin;
            if (!backend_subprocess) return false;
            exitToken = expectBackendExit(session, path);
            writeAttempted = true;
            const sent = await backend_subprocess.write(JSON.stringify(send_object) + "\n") !== false;
            return sent && store.backend_session === session && store.backend_subprocess === backend_subprocess;
        }, () => {
            settingsWriteResponses.fail(settingsRequest, writeAttempted);
            // An old write completion owns neither the new session's exit latch
            // nor its pending controls. Uncertain writes are never replayed.
            if (store.backend_session !== session || store.backend_subprocess !== backend_subprocess) return;
            if (languageRejected) return;
            // Without a session there is no exit token to undo (expectBackendExit gave null).
            if (session) undoExpectedExit(session, exitToken);
            if (request) {
                // Preserve language ownership when a write may have reached Python.
                if (writeAttempted) languageMutationWriteUnconfirmed(request.requestId);
                else failLanguageMutationBeforeSend(request.requestId);
            } else failLanguageRead(path);
            const restored = pendingRequestRecovery.failSend(path, value, pendingVersion);
            if (restored && !store.backend_stopped) {
                showNotification_Error(t("common_error.request_send_failed"), { category_id: "request_send_failed" });
            }
        });
        return sent && settingsRequest ? settingsRequest.response : sent;
    };
    return { asyncStdoutToPython };
};

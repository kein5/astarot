import { createElement } from "react";
import {
    useNotificationStatus,
    useIsOscAvailable,
} from "@logics_common";
import { TranslatedNotice } from "./TranslatedNotice";

// /run/enable_osc_query (docs/spec/external-interfaces.md): whether OSC reception and the
// OSCQuery advertisement are ready, and if not, why and which functions were switched off.
export interface OscQueryPayload {
    data: boolean;
    disabled_functions: readonly string[];
    reason?: string | null;
    microphone_stopped?: boolean;
}

// Which warning to show: why reception is unavailable, and whether the
// microphone was stopped because mute sync had been on. One text for all four
// told people sending to another machine to re-save their local OSC settings,
// and said the microphone "has also been stopped" when nothing had been.
// OSCQuery turned off by the user (#559) has nothing to fix but the switch.
const CAUSES: Readonly<Record<string, string>> = { remote_destination: "remote", turned_off: "off" };
const warningKey = (reason: unknown, microphone_stopped: unknown) => {
    const cause = (typeof reason === "string" && CAUSES[reason]) || "failed";
    return `common_warning.osc_query_${cause}${microphone_stopped === true ? "_mic_stopped" : ""}`;
};

export const useHandleOscQuery = () => {
    const { showNotification_Warning } = useNotificationStatus();
    const { updateIsOscAvailable, updateOscUnavailableReason } = useIsOscAvailable();

    const handleOscQuery = (payload: OscQueryPayload) => {
        const is_osc_query_enabled = payload.data;
        const disabled_functions = payload.disabled_functions;

        // 受信とOSCQuery広告の準備ができた場合だけ有効にする。
        if (is_osc_query_enabled) {
            updateIsOscAvailable(true);
            updateOscUnavailableReason(null);

        } else {
            updateIsOscAvailable(false);
            // 設定画面の同期の欄が、使えない理由を表示するのに使う。
            updateOscUnavailableReason(payload.reason ?? "setup_failed");

            // バックエンドが知らせるべきだと判断したときだけ通知する（起動しただけで何も止めていない場合は空で届く）。
            if (disabled_functions.includes("vrc_mic_mute_sync")) {
                // 起動時は、保存した表示言語が適用される前に届く。文言は表示するときに決める。
                const k = warningKey(payload.reason, payload.microphone_stopped);
                showNotification_Warning(createElement(TranslatedNotice, { k, labels: {
                    sync: "config_page.others.vrc_mic_mute_sync.label",
                    microphone: "main_page.transcription_send",
                    settings: "config_page.side_menu_labels.advanced_settings",
                } }), { hide_duration: 10000, category_id: k });
            }
        }
    };

    return { handleOscQuery };
};

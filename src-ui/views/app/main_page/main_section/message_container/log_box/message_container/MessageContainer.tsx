import { memo, useRef, useState } from "react";
import { useI18n } from "@useI18n";
import clsx from "clsx";
import styles from "./MessageContainer.module.scss";
import * as speakerStyles from "./SpeakerNames.css.ts";
import { SpeakerNamesEditor, speakersText } from "./SpeakerNames.tsx";
import { MessageSubMenuContainer } from "./message_sub_menu_container/MessageSubMenuContainer";
import { store } from "@store";
import type { MessageActions } from "../../../../../../../logics/common/MessageActions";
import type { SessionSpeakerNames } from "../../../../../../../logics/common/speakerNames.ts";
import type { MessageLogContent, MessageLogRow, MessageLogText, TransliterationToken } from "../../../../../../../logics/transcription/realtimeCaptionState";

// The row's own fields (MessageLogRow), with what the log adds.
type MessageContainerProps = MessageLogRow & {
    speaker_names: SessionSpeakerNames | undefined;
    continues: boolean;
    nameSpeakers: ((namespace: string, names: SessionSpeakerNames) => void) | undefined;
    sendMessage: MessageActions["sendMessage"] | undefined;
    updateMessageInputValue: MessageActions["updateMessageInputValue"] | undefined;
    showResendButton: boolean;
};

// The realtime outcomes whose row says why the message was not sent.
const NOT_SENT_REASONS: readonly unknown[] = ["expired", "revoked", "superseded", "filtered"];

// `speaker_names`: the names given to the voices of this row's session (#447). `continues`: the
// row goes on with the voices of the row above, so who spoke is shown there only (read aloud
// here). `nameSpeakers`: names this row's voices; absent where nothing can be typed (VR panel).
export const MessageContainer = memo(function MessageContainer({ id, messages, status, category, created_at, source, realtime, delivery_reason,
    speakers, speaker_names, continues, nameSpeakers, sendMessage, updateMessageInputValue, showResendButton }: MessageContainerProps) {
    const { t } = useI18n();
    const [is_hovered, setIsHovered] = useState(false);
    const [is_locked, setIsLocked] = useState(false);
    const [is_naming, setIsNaming] = useState(false);
    const who_button = useRef<HTMLButtonElement>(null);

    // The resend button is there only with the actions (showResendButton), and only on a row of
    // the user's own, whose text is always there.
    const resendFunction = () => {
        sendMessage?.(messages.original.message);
    };
    const editFunction = () => {
        updateMessageInputValue?.(messages.original.message ?? "");
    };

    const handleMouseEnter = () => {
        if (!is_locked) {
            setIsHovered(true);
        }
    };

    const handleMouseLeave = () => {
        setIsHovered(false);
        setIsLocked(false);
    };

    const lockHoverState = () => {
        setIsHovered(false);
        setIsLocked(true);
    };

    const is_translation_exist = messages.translations?.length > 0;
    const is_pending = status === "pending";
    const is_failed = status === "failed";
    const is_not_sent = status === "not_sent";
    const is_sent_message = category === "sent";
    const is_system_message = category === "system";
    const is_ocr_message = source === "ocr";
    const is_realtime = source === "realtime_mic" || source === "realtime_speaker";
    // The message reached the log and the other outputs, but the chatbox is switched off.
    const is_vrchat_off = is_sent_message && status === "ok" && (realtime?.reason ?? delivery_reason) === "vrchat_off";
    const not_sent_key = NOT_SENT_REASONS.includes(realtime?.reason)
        ? `not_sent_${realtime?.reason}` : "not_sent";
    const category_text = is_realtime && is_not_sent
        ? t(`main_page.message_log.${is_sent_message ? not_sent_key : "processing_stopped"}`)
        : is_realtime && is_failed
        ? t(`main_page.message_log.${is_sent_message ? "send_unconfirmed" : "processing_failed"}`)
        : is_realtime && is_pending && !is_sent_message
        ? t("main_page.message_log.processing")
        : is_sent_message
        ? t(`main_page.message_log.${is_failed ? "send_unconfirmed" : is_pending ? "sending" : is_vrchat_off ? "sent_vrchat_off" : "sent"}`)
        : is_system_message
        ? t("main_page.message_log.system")
        : is_ocr_message
        ? t("main_page.message_log.received_ocr")
        : t("main_page.message_log.received");
    // Who spoke, where the server told the voices apart: "A", or "A・B" when two share a caption,
    // with the names the user gave them.
    const speakers_text = !is_sent_message && speakers?.length ? speakersText(t, speakers, speaker_names) : null;
    const can_name = !!speakers_text && !!nameSpeakers && !!realtime?.namespace && !store.is_vr_panel;
    const closeNaming = () => {
        setIsNaming(false);
        who_button.current?.focus();
    };

    const message_type_class_name = clsx({
        [styles.sent_message]: is_sent_message,
        [styles.received_message]: !is_sent_message && !is_system_message,
        [styles.system_message]: is_system_message,
    });

    return (
        <div
            data-log-row={id}
            className={clsx(styles.container, message_type_class_name)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <div className={clsx(styles.message_wrapper, message_type_class_name, { [styles.continues]: continues })}>
                <div className={clsx(styles.info_box, message_type_class_name)}>
                    <p className={styles.time}>{created_at}</p>
                    {/* A row that goes on with the same voices shows only its time; who spoke is read aloud. */}
                    {!continues && <p className={clsx(styles.category, message_type_class_name, {
                        [styles.ocr_category]: is_ocr_message, [styles.failed]: is_failed,
                        [styles.not_sent]: is_not_sent, [styles.vrchat_off]: is_vrchat_off,
                    })}>{category_text}</p>}
                    {speakers_text && continues && <span className={speakerStyles.hidden}>{speakers_text}</span>}
                    {speakers_text && !continues && (can_name
                        ? <button ref={who_button} type="button" className={speakerStyles.who} aria-expanded={is_naming}
                            aria-label={t("main_page.message_log.speaker_names_edit", { speakers: speakers_text })}
                            title={t("main_page.message_log.speaker_names_tooltip")}
                            onClick={() => setIsNaming(open => !open)}>{speakers_text}</button>
                        : <p className={clsx(styles.category, message_type_class_name)}>{speakers_text}</p>)}
                    {/* The VR atlas needs static pixels while a send is pending. Its label above shows the state. */}
                    {(is_sent_message || is_realtime) && is_pending && !store.is_vr_panel && <span className={styles.loader} aria-hidden="true"></span>}
                </div>
                {can_name && is_naming && !continues && speakers && <SpeakerNamesEditor labels={speakers} names={speaker_names}
                    onSave={names => nameSpeakers(realtime.namespace, names)} onClose={closeNaming} />}
                <div className={clsx(styles.message_box, message_type_class_name)}>
                    {is_system_message ? (
                        <p className={styles.message_main_system}>{messages.original.message}</p>
                    ) : is_translation_exist ? (
                        <WithTranslatedMessages messages={messages} />
                    ) : (
                        <OriginalMessage messages={messages} />
                    )}
                </div>
            </div>
            {/* VRパネルでは、レーザーの誤操作で過去のメッセージを再送しないよう出さない */}
            {/* Rendered whenever enabled so the keyboard can reach it; shown on hover or focus. */}
            {showResendButton && is_sent_message && !store.is_vr_panel ? (
                <MessageSubMenuContainer
                    is_shown={is_hovered}
                    setIsHovered={lockHoverState}
                    resendFunction={resendFunction}
                    editFunction={editFunction}
                />
            ) : null}
        </div>
    );
});

const MessageWithTransliteration = ({ item }: { item: MessageLogText }) => {
    const renderTokenNode = (token: TransliterationToken, key: number) => {
        const orig = token.orig ?? "";
        const hira = token.hira ?? "";
        const hepburn = token.hepburn ?? "";

        // Only hovered romaji if it exists. (No ruby cuz 'orig' and 'hira' are same.)
        if (hira && hira === orig && hepburn) {
            return (
                <span key={key} title={hepburn} className={styles.with_hepburn}>
                    {orig}
                </span>
            );
        }

        // Ruby hiragana and hovered romaji.
        if (hira && hepburn) {
            return (
                <ruby key={key} title={hepburn} className={styles.with_hepburn}>
                    {orig}
                    <rt>{hira}</rt>
                </ruby>
            );
        }

        // Ruby romaji or hiragana.
        if (hepburn || hira) {
            const ruby = hepburn ? hepburn : hira;
            if (ruby !== orig) {
                return (
                    <ruby key={key} className={styles.ruby}>
                        {orig}
                        <rt>{ruby}</rt>
                    </ruby>
                );
            };
        }

        // Nothing. Original only.
        return (
            <span key={key} className={styles.original_only}>
                {orig}
            </span>
        );
    };

    if (!item.transliteration.length) {
        return <p className={styles.message_main}>{item.message}</p>;
    }

    return (
        <p className={styles.message_main}>
            {item.transliteration.map((token, idx) => renderTokenNode(token, idx))}
        </p>
    );
};

const OriginalMessage = ({ messages }: { messages: MessageLogContent }) => {
    return (
        <>
            <MessageWithTransliteration item={messages.original} />
        </>
    );
};

const WithTranslatedMessages = ({ messages }: { messages: MessageLogContent }) => {
    return (
        <>
            <p className={styles.message_second}>{messages.original.message}</p>
            {messages.translations.map((item, idx) => (
                <div key={idx}>
                    <MessageWithTransliteration item={item} />
                </div>
            ))}
        </>
    );
};

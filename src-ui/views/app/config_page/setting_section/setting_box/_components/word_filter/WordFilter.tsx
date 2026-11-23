import { useI18n } from "@useI18n";
import * as styles from "./WordFilter.css.ts";
import { _Entry } from "../_atoms/_entry/_Entry";
import { useState, useRef, useEffect, useCallback } from "react";
import type { ChangeEvent } from "react";
import type { EntryHandle } from "../_atoms/_entry/_Entry";
import { useStore_IsOpenedMicWordFilterList } from "@store";
import { Fold } from "../fold/Fold";
import { useTranscription } from "@logics_configs";
import { useSettingsDraft } from "../../../../../../../logics/voice/useSettingsDraft";

export const WordFilter = (props: { "aria-labelledby"?: string; "aria-describedby"?: string }) => {
    const { t } = useI18n();

    const [input_value, setInputValue] = useState("");
    const { currentMicWordFilterList, setMicWordFilterList } = useTranscription();
    const { currentIsOpenedMicWordFilterList, updateIsOpenedMicWordFilterList } = useStore_IsOpenedMicWordFilterList();

    const [error, setError] = useState<string | null>(null);
    const form = useSettingsDraft(currentMicWordFilterList.data, error, setError, {
        write: setMicWordFilterList,
        label: () => t("config_page.transcription.mic_word_filter.label"),
    });
    const words = form.draft ?? currentMicWordFilterList.data;

    const listSectionRef = useRef<HTMLDivElement | null>(null);
    const shouldScrollToBottomRef = useRef(false);
    const entryRef = useRef<EntryHandle>(null);
    const deleteRefs = useRef(new Map<string, HTMLButtonElement>());
    // The word just removed and its button: focus goes to the next word's button once it is gone.
    const pendingFocusRef = useRef<{ word: string; button: HTMLButtonElement; index: number } | null>(null);

    useEffect(() => {
        const pending = pendingFocusRef.current;
        if (!pending || words.includes(pending.word)) return;
        pendingFocusRef.current = null;
        // Do not take focus back if the user moved while the update settled.
        if (document.activeElement !== pending.button && document.activeElement !== document.body) return;
        const word = words[Math.min(pending.index, words.length - 1)];
        (deleteRefs.current.get(word) ?? entryRef.current)?.focus();
    }, [words]);

    const setListSectionRef = useCallback((node: HTMLDivElement | null) => {
        listSectionRef.current = node;
        if (node) {
            node.scrollTop = node.scrollHeight;
            requestAnimationFrame(() => {
                if (listSectionRef.current) {
                    listSectionRef.current.scrollTop = listSectionRef.current.scrollHeight;
                }
            });
        }
    }, []);

    useEffect(() => {
        if (shouldScrollToBottomRef.current) {
            shouldScrollToBottomRef.current = false;
            requestAnimationFrame(() => {
                if (listSectionRef.current) {
                    listSectionRef.current.scrollTop = listSectionRef.current.scrollHeight;
                }
            });
        }
    }, [words, currentIsOpenedMicWordFilterList.data]);

    const onChangeEntry = (e: ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value);
    };

    const handleEnterPressed = () => {
        if (!input_value?.trim()) return;
        addWords();
    };

    const addWords = () => {
        if (input_value === undefined) return;
        const updated_list = [...words];
        for (const word of input_value.split(",").map(value => value.trim())) {
            if (word && !updated_list.includes(word)) updated_list.push(word);
        }
        if (updated_list.length !== words.length) {
            form.setDraft(updated_list);
            shouldScrollToBottomRef.current = true;
        }
        updateIsOpenedMicWordFilterList(true);
        setInputValue("");
    };

    const deleteAction = (target_item_value: string, button: HTMLButtonElement) => {
        pendingFocusRef.current = { word: target_item_value, button,
            index: words.indexOf(target_item_value) };
        form.setDraft(words.filter(item => item !== target_item_value));
    };


    // The registered words are a bar of the app's one fold (#820): the bar says how many there
    // are, and the words are inside it. Whether it is open is kept while the app runs, and adding
    // words opens it. With no word the bar stays, at 0, and says so inside.
    const opened = currentIsOpenedMicWordFilterList.data === true;
    return (
        <div className={styles.container} role="group" aria-labelledby={props["aria-labelledby"]}>
            {form.navigationDialog}
            <Fold open={opened} summary={t("config_page.transcription.mic_word_filter.list", { count: words.length })}
                summaryProps={{ "aria-describedby": props["aria-describedby"] }}
                onToggle={event => {
                    const open = event.currentTarget.open;
                    if (open !== opened) updateIsOpenedMicWordFilterList(open);
                }}>
                { opened && (words.length === 0
                    ? <p className={styles.empty}>{t("config_page.transcription.mic_word_filter.list_empty")}</p>
                    : <div ref={setListSectionRef} className={styles.list_section_wrapper}>
                        {
                            words.map((item) => {
                                return <WordFilterItem value={item} key={item} deleteAction={deleteAction}
                                    buttonRef={node => {
                                        if (node) deleteRefs.current.set(item, node);
                                        else deleteRefs.current.delete(item);
                                    }}/>;
                            })
                        }
                    </div>)
                }
            </Fold>
            <div className={styles.entry_section_wrapper}>
                <_Entry ref={entryRef} aria-describedby={props["aria-describedby"]} aria-label={t("config_page.transcription.mic_word_filter.label")} width="30rem" onChange={onChangeEntry} onEnterPressed={handleEnterPressed} ui_variable={input_value}/>
                <button className={styles.add_button} onClick={addWords}>{t("config_page.transcription.mic_word_filter.add_button_label")}</button>
            </div>
        </div>
    );
};

import DeleteSvg from "@images/cancel.svg?react";
import clsx from "clsx";
interface WordFilterItemProps {
    value: string;
    deleteAction: (value: string, button: HTMLButtonElement) => void;
    buttonRef: (node: HTMLButtonElement | null) => void;
}

const WordFilterItem = (props: WordFilterItemProps) => {
    const { t } = useI18n();
    const item_wrapper_class_names = clsx(styles["item_wrapper"]);
    const item_text_class_names = clsx(styles["item_text"]);

    return (
        <div className={item_wrapper_class_names}>
            <p className={item_text_class_names}>{props.value}</p>
            <button type="button" ref={props.buttonRef} className={clsx(styles.action_button, styles.delete_)}
                aria-label={t("config_page.transcription.mic_word_filter.remove_word", { word: props.value })}
                onClick={event => props.deleteAction(props.value, event.currentTarget)}>
                <DeleteSvg className={styles.delete_svg} aria-hidden="true" focusable="false"/>
            </button>
        </div>
    );
};

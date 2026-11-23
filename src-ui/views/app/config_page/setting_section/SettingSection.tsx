import { useRef, useLayoutEffect, useEffect } from "react";
import type { RefObject } from "react";

import * as styles from "./SettingSection.css.ts";
import { SettingBox } from "./setting_box/SettingBox";
import { store, useStore_SelectedConfigTabId } from "@store";
import { useSettingBoxScrollPosition } from "@logics_configs";
import { useSaveBarEntries } from "../../../../logics/voice/saveBar";

// The top bar only counts unsaved changes; the rows they belong to are marked
// here. Changes are named by their row labels, so a row matches by its label:
// template rows and FormRow carry data-setting-label, and the voice forms' plain
// <label> rows start with their label text. Rows re-render freely, so the marks
// are reapplied whenever the page's DOM changes.
// The rows are HTML elements; Element itself has no dataset.
const hasDataset = (row: Element): row is Element & HTMLOrSVGElement => "dataset" in row;

export const markUnsavedRows = (root: ParentNode, names: ReadonlySet<string>) => {
    root.querySelectorAll("[data-setting-label]").forEach(row => {
        if (!hasDataset(row)) return;
        const label = row.dataset.settingLabel;
        row.toggleAttribute("data-unsaved", label !== undefined && names.has(label));
    });
    root.querySelectorAll("label").forEach(row => {
        if (row.closest("[data-setting-label]")) return;
        const text = row.firstChild?.nodeType === Node.TEXT_NODE ? (row.firstChild.textContent ?? "").trim() : null;
        row.toggleAttribute("data-unsaved", text !== null && names.has(text));
    });
    // A fold (「詳細設定」, 「モデルとサーバー」) marks its line while a row inside it has
    // unsaved edits, so a change is not hidden when the fold is closed (#554).
    root.querySelectorAll("details").forEach(fold => {
        fold.toggleAttribute("data-unsaved-inside", fold.querySelector("[data-unsaved]") !== null);
    });
};

const useUnsavedRowMarks = (ref: RefObject<HTMLElement | null>) => {
    const entries = useSaveBarEntries();
    const key = JSON.stringify([...new Set(entries.filter(entry => entry.dirty).flatMap(entry => entry.changes))]);
    useEffect(() => {
        const root = ref.current;
        if (!root) return;
        const names = new Set<string>(JSON.parse(key));
        markUnsavedRows(root, names);
        const observer = new MutationObserver(() => markUnsavedRows(root, names));
        observer.observe(root, { childList: true, subtree: true, characterData: true });
        return () => observer.disconnect();
    }, [ref, key]);
};

export const SettingSection = () => {
    const { currentSelectedConfigTabId } = useStore_SelectedConfigTabId();
    const { resetScrollPosition } = useSettingBoxScrollPosition();
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    useUnsavedRowMarks(scrollContainerRef);

    useLayoutEffect(() => {
        store.setting_box_scroll_container = scrollContainerRef;
    }, []);

    useEffect(() => {
        resetScrollPosition();
    }, [currentSelectedConfigTabId.data]);

    return (
        <div ref={scrollContainerRef} className={styles.scroll_container}>
            <div className={styles.container}>
                <SettingBox />
            </div>
        </div>
    );
};
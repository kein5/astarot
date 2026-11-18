import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "@useI18n";

import { useLanguageSettings } from "@logics_main";
import { createLanguageNames, isLanguagePickKey } from "../../../../../logics/common/languageNames.ts";
import styles from "./LanguageSelector.module.scss";

import { LanguageSelectorTopBar } from "./language_selector_top_bar/LanguageSelectorTopBar";
// `hint` says what the language is for, in both directions (#569). It stays in sight above the
// list and describes the search field, which has the focus when the list opens.
export const LanguageSelector = ({ title, hint, onClickFunction }) => {
    const { t, i18n } = useI18n();
    const names = useMemo(() => createLanguageNames(i18n.language), [i18n.language]);
    const { currentSelectableLanguageList } = useLanguageSettings();
    const hint_id = useId();

    // Typing narrows the list by language or country, or by the beginning of an
    // ISO 639 code ("j", "ja", "zh-Hant"), whose languages come first; Enter picks the first
    // match. The field takes focus when the selector opens.
    const [query, setQuery] = useState("");
    const filter = useRef(null);
    useEffect(() => { filter.current?.focus({ preventScroll: true }); }, []);
    const shown = useMemo(() => names.search(currentSelectableLanguageList.data ?? [], query),
        [names, currentSelectableLanguageList.data, query]);

    return (
        <div className={styles.container}>
            <LanguageSelectorTopBar title={title}/>
            <div className={styles.language_list_scroll_wrapper}>
                <div className={styles.filter_row}>
                    <input ref={filter} type="search" className={styles.filter} value={query}
                        placeholder={t("main_page.language_selector.filter")} aria-label={t("main_page.language_selector.filter")}
                        aria-describedby={hint ? hint_id : undefined}
                        onChange={event => setQuery(event.target.value)}
                        onKeyDown={event => {
                            if (isLanguagePickKey(event) && shown.length) {
                                event.preventDefault();
                                onClickFunction({ language: shown[0].language, country: shown[0].country });
                            }
                        }} />
                    {hint && <p id={hint_id} className={styles.hint}>{hint}</p>}
                </div>
                {shown.length ? (
                    <div className={styles.language_list}>
                        {shown.map(entry => (
                            <LanguageButton key={`${entry.language}/${entry.country}`} onClickFunction={onClickFunction}
                                language_data={entry} label={names.name(entry).label} />
                        ))}
                    </div>
                ) : (
                    <p role="status" className={styles.no_results}>{t("main_page.language_selector.no_results")}</p>
                )}
            </div>
        </div>
    );
};

const LanguageButton = ({ onClickFunction, language_data, label }) => {

    const adjustedOnClickFunction = () => {
        onClickFunction({
            language: language_data.language,
            country: language_data.country,
        });
    };

    return (
        <button type="button" className={styles.language_button} onClick={adjustedOnClickFunction}>
            <span className={styles.language_label}>{label}</span>
        </button>
    );
};

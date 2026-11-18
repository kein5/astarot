import { useEffect, useState } from "react";
import { useI18n } from "@useI18n";
import { store } from "@store";
import { useSettingValue } from "@logics_configs";
import { useSetupNeeds } from "../../../../../../logics/main/useSetupNeeds";
import { downloadProgress } from "../../../../../../logics/main/setupNeeds";
import { useRecognitionState } from "../../../../../../logics/setup/useRecognitionState";
import { useFirstRunSetup } from "../../../../../../logics/setup/useFirstRunSetup";
import { useStartupPlaceholder } from "../../../startupContext";
import styles from "./LogBox.module.scss";

// The first screen of a session. It says where to type and, in the main window,
// what the selected engines still need, each with the step that provides it: the
// download review, or the settings where the local speech recognition models are set.
// While the engine starts, the main page's startup list (StartupProgress) takes
// its place: how far the start has come and which models it is fetching.
// The greeting sits in the middle row and the list in the row below it, so the list
// changing at startup never moves the greeting (LogBox.module.scss).
// The main window draws at the default UI size and in a provisional language until the saved
// settings arrive, then takes the saved size, which moves everything, the saved language, and
// at a large size the narrow layout, which widens the conversation and so its heading's size.
// The greeting is drawn from then on, so the first place it is seen is where it stays and its
// words and size do not change under the eye. Its room is kept, so nothing under it moves when
// it appears. The VR panel gets its settings from the main window and does not wait.
// Once drawn it stays: a later resize or settings change does not hide it again.
export const EmptyState = () => {
    const { t, i18n } = useI18n();
    const startup = useStartupPlaceholder();
    const scaling = useSettingValue("UiScaling");
    const language = useSettingValue("UiLanguage");
    const narrow = useNarrowLayout();
    const reason = store.is_vr_panel ? null : greetingWaits({ scaling, language, shownLanguage: i18n?.language,
        width: globalThis.innerWidth, narrow });
    const waiting = !useShownOnce(reason) && reason !== null;
    return <div className={styles.empty}>
        <div className={styles.greeting} data-waiting={waiting || undefined} aria-hidden={waiting || undefined}>
            <h1>{t("studio.empty_title")}</h1>
            <p>{t("studio.empty_description")}</p>
        </div>
        {!store.is_vr_panel && <div className={styles.next}>{startup ?? <Setup />}</div>}
    </div>;
};

// What the greeting still waits for, or null: "settings" until the saved UI size and language
// arrive, then "language" until the saved language is shown and "layout" until the narrow layout
// fits the UI size. The narrow layout is decided as useWindow decides it (a window at most 800
// CSS px wide at 100%, scaled with the UI size) and marked on the root as data-narrow. Within a
// pixel of that width either layout counts.
export const greetingWaits = ({ scaling, language, shownLanguage, width, narrow }) => {
    if (scaling?.state === "pending" || language?.state === "pending") return "settings";
    if (language?.data && shownLanguage !== undefined && shownLanguage !== language.data) return "language";
    const breakPoint = 8 * scaling?.data;
    if (!Number.isFinite(width) || !Number.isFinite(breakPoint) || Math.abs(width - breakPoint) <= 1) return null;
    return narrow !== (width <= breakPoint) ? "layout" : null;
};

// The language and the layout follow the settings within a fraction of a second; should either
// not follow (a failed window query), the greeting is drawn after this long all the same.
export const GREETING_FOLLOW_MS = 1000;

// True from the first render that waits for nothing, or GREETING_FOLLOW_MS after the settings
// arrived. Missing settings are waited for without a limit: the startup list says why.
const useShownOnce = (reason) => {
    const [shown, setShown] = useState(false);
    useEffect(() => {
        if (shown || reason === "settings") return;
        if (reason === null) { setShown(true); return; }
        const timer = setTimeout(() => setShown(true), GREETING_FOLLOW_MS);
        return () => clearTimeout(timer);
    }, [shown, reason === null || reason === "settings" ? reason : "following"]);
    return shown;
};

// Whether the root is marked narrow (useWindow), kept current by watching the mark. It is read
// from the page, not from the IsBreakPoint state, which the VR panel is not sent.
const narrowNow = () => !!globalThis.document?.documentElement?.hasAttribute("data-narrow");
const useNarrowLayout = () => {
    const [narrow, setNarrow] = useState(narrowNow);
    useEffect(() => {
        if (store.is_vr_panel || typeof MutationObserver === "undefined") return;
        const observer = new MutationObserver(() => setNarrow(narrowNow()));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-narrow"] });
        setNarrow(narrowNow());
        return () => observer.disconnect();
    }, []);
    return narrow;
};

const Setup = () => {
    const { t } = useI18n();
    const { needs, start } = useSetupNeeds();
    const sends = useSettingValue("EnableSendMessageToVrc");
    // Nothing chosen for the recognition yet, or the bundled server without its models:
    // the first-run setup prepares it in one go (#557).
    const { state: recognition } = useRecognitionState();
    const { openSetup } = useFirstRunSetup();
    const firstRun = recognition === "needs_setup";
    return <>
        {firstRun && <ul className={styles.setup} aria-label={t("studio.setup_label")}>
            <li>
                <span>{t("studio.setup_first_run")}</span>
                <button type="button" onClick={openSetup}>{t("studio.setup_first_run_open")}</button>
            </li>
        </ul>}
        {!firstRun && needs.length > 0 && <ul className={styles.setup} aria-label={t("studio.setup_label")}>
            {needs.map(({ id, weight, action }) => {
                const progress = downloadProgress(weight);
                // "choose": the translation model cannot be downloaded yet, so another translator is offered.
                return <li key={id}>
                    <span>{t(action === "choose" ? "studio.setup_translation_unavailable" : `studio.setup_${id}`)}</span>
                    {progress === null
                        ? <button type="button" onClick={() => start(id)}>
                            {t(action === "settings" ? "studio.setup_open_settings"
                                : action === "choose" ? "studio.setup_other_translator" : "model_downloads.review")}</button>
                        : <span role="status">{t(progress === "pending" ? "studio.setup_preparing" : "studio.setup_downloading", { progress })}</span>}
                </li>;
            })}
        </ul>}
        {sends?.data === true && <p className={styles.hint}>{t("studio.empty_vrchat_hint")}</p>}
    </>;
};

import { useEffect, useState } from "react";
import { useI18n } from "@useI18n";
import { store } from "@store";
import type { AtomState } from "@store";
import { useSettingValue } from "@logics_configs";
import { useSetupNeeds } from "../../../../../../logics/main/useSetupNeeds";
import { downloadProgress } from "../../../../../../logics/main/setupNeeds";
import { useRecognitionState } from "../../../../../../logics/setup/useRecognitionState";
import { useFirstRunSetup } from "../../../../../../logics/setup/useFirstRunSetup";
import { hasSetupWork, setupSuggested, setupWork } from "../../../../../../logics/setup/firstRunSetup.ts";
import { useStartupPlaceholder } from "../../../startupContext";
import { useVrchatHint } from "../../../vrchatHintContext";
import { Button } from "../../../../../kit/index.ts";
import * as styles from "./LogBox.css.ts";

// The first screen of a session: a greeting and, in the main window, what the selected
// engines still need, each with the step that provides it: the download review, or the
// settings where the local speech recognition models are set. Where to type is not said in
// words (#614): the composer under the log says it by its place and its placeholder.
// Under the list, the main window's line on turning OSC on in VRChat stands only while no
// VRChat with OSC on is found (VrchatOscHint, handed down by MainPage).
// While the engine starts, the main page's startup list (StartupProgress) takes
// its place: how far the start has come and which models it is fetching.
// The greeting sits in the middle row and the list in the row below it, so the list
// changing at startup never moves the greeting (LogBox.css.ts).
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
        </div>
        {!store.is_vr_panel && <div className={styles.next}>{startup ?? <Setup />}</div>}
    </div>;
};

// What the greeting still waits for, or null: "settings" until the saved UI size and language
// arrive, then "language" until the saved language is shown and "layout" until the narrow layout
// fits the UI size. The narrow layout is decided as useWindow decides it (a window at most 800
// CSS px wide at 100%, scaled with the UI size) and marked on the root as data-narrow. Within a
// pixel of that width either layout counts.
export type GreetingWait = "settings" | "language" | "layout" | null;

type GreetingInput = {
    scaling: AtomState<number> | undefined;
    language: AtomState<string> | undefined;
    shownLanguage: string | undefined;
    width: number;
    narrow: boolean;
};

export const greetingWaits = ({ scaling, language, shownLanguage, width, narrow }: GreetingInput): GreetingWait => {
    if (scaling?.state === "pending" || language?.state === "pending") return "settings";
    if (language?.data && shownLanguage !== undefined && shownLanguage !== language.data) return "language";
    // Without the UI size there is no break point.
    const breakPoint = scaling ? 8 * scaling.data : NaN;
    if (!Number.isFinite(width) || !Number.isFinite(breakPoint) || Math.abs(width - breakPoint) <= 1) return null;
    return narrow !== (width <= breakPoint) ? "layout" : null;
};

// The language and the layout follow the settings within a fraction of a second; should either
// not follow (a failed window query), the greeting is drawn after this long all the same.
export const GREETING_FOLLOW_MS = 1000;

// True from the first render that waits for nothing, or GREETING_FOLLOW_MS after the settings
// arrived. Missing settings are waited for without a limit: the startup list says why.
const useShownOnce = (reason: GreetingWait) => {
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
    // The main window's line about VRChat; it draws nothing unless it has something to say.
    const VrchatHint = useVrchatHint();
    // What the first-run setup prepares (#557): the recognition (nothing chosen yet, or the bundled
    // server without its models) and the translation's model when the selected one can be
    // downloaded (#936). While either is left, one line leads to the setup, in place of the needs
    // it covers; it says which are left. Needs it does not cover keep their own lines.
    const { state: recognition } = useRecognitionState();
    const { openSetup, notice } = useFirstRunSetup();
    const work = setupWork(recognition, needs.find(need => need.id === "translation")?.action);
    const firstRun = hasSetupWork(work);
    const rest = needs.filter(need => !(need.id === "translation" && work.translation) && !(need.id === "transcription" && work.recognition));
    const firstRunWords = work.recognition && work.translation ? "studio.setup_first_run_both"
        : work.translation ? "studio.setup_first_run_translation" : "studio.setup_first_run";
    // The setup does not open by itself (#935). While it is still suggested, its line leads the
    // first screen: framed in lilac, its button the kit's primary one, so the user sees where to
    // start. Every other step is the kit's plain button.
    const lead = setupSuggested(notice, work);
    return <>
        {(firstRun || rest.length > 0) && <ul className={styles.setup} aria-label={t("studio.setup_label")}>
            {firstRun && <li data-lead={lead || undefined}>
                <span>{t(firstRunWords)}</span>
                <Button tone={lead ? "primary" : "plain"} className={styles.setup_action} onClick={openSetup}>
                    {t("studio.setup_first_run_open")}</Button>
            </li>}
            {rest.map(({ id, weight, action }) => {
                const progress = downloadProgress(weight);
                // "choose": the translation model cannot be downloaded yet, so another translator is offered.
                return <li key={id}>
                    <span>{t(action === "choose" ? "studio.setup_translation_unavailable" : `studio.setup_${id}`)}</span>
                    {progress === null
                        ? <Button className={styles.setup_action} onClick={() => start(id)}>
                            {t(action === "settings" ? "studio.setup_open_settings"
                                : action === "choose" ? "studio.setup_other_translator" : "model_downloads.review")}</Button>
                        : <span role="status">{t(progress === "pending" ? "studio.setup_preparing" : "studio.setup_downloading", { progress })}</span>}
                </li>;
            })}
        </ul>}
        {VrchatHint && <VrchatHint className={styles.hint} />}
    </>;
};

import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { useI18n } from "@useI18n";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useVoice } from "../../../../../../logics/voice/useVoice";
import { TTS_ENGINES } from "../tts/TtsEngine";
import type { TtsEngineSpec } from "../tts/TtsEngine";
import { EnvReadout } from "../_components/env_readout/EnvReadout";
import { useHintDescriptions } from "../_components/hint/Hint";
import { catalogHeading } from "./catalogHeading";
import { CatalogFacts, CatalogList } from "./catalogLayout";
import type { CatalogLayout } from "./catalogLayout";
import styles from "./VoiceSettings.module.scss";

// The speech engines a user installs and runs themselves (ADR-008), listed beside the models.
// The app never downloads, installs or starts them: each card sends the user to the official
// site and says whether the engine answers at its saved address. A check asks only for the
// engine's version and voice list, on this PC (loopback addresses only), once when the list
// first shows and again on request. Choosing an engine stays in "Engine for Japanese" above.
// layout: the catalog's layout, which the engines' cards share with the models' above them.
export const EngineCatalog = ({ layout = "list" }: { layout?: CatalogLayout }) => {
    const { t } = useI18n();
    const hints = useHintDescriptions();
    const { settings, engineChecks, send } = useVoice();
    const [linkError, setLinkError] = useState<string | null>(null);
    const address = (spec: TtsEngineSpec) => settings?.[spec.url] || spec.example;
    const check = (id: string, spec: TtsEngineSpec) => send("/get/data/tts_engine_voices", { engine: id, url: address(spec), catalog: true });
    // Wait for the saved settings, so the first check uses the saved address, not the example.
    const loaded = !!settings;
    // biome-ignore lint/correctness/useExhaustiveDependencies: checks once, when the saved settings arrive; a check's result or a typed address must not start another round.
    useEffect(() => {
        if (loaded) for (const [id, spec] of Object.entries(TTS_ENGINES)) if (!engineChecks[id]) check(id, spec);
    }, [loaded]);
    const open = async (event: MouseEvent<HTMLAnchorElement>, link: string) => {
        if (!isTauri()) return;
        event.preventDefault();
        try { await openUrl(link); setLinkError(null); }
        catch { setLinkError(link); }
    };
    const inUse = settings?.japanese_engine || "speechcpp";
    return <section className={styles.catalog_group} aria-labelledby="model-catalog-engines">
        {catalogHeading(hints, "h4", t("model_catalog.group.engines"), [t("model_catalog.group_help.engines")], "model-catalog-engines")}
        {/* The voices' credit terms are seen before an engine is used, so they stay on screen (#614). */}
        <p>{t("model_catalog.engine.terms_notice")}</p>
        {linkError && <p role="alert">{t("model_downloads.link_error")} <code>{linkError}</code></p>}
        <CatalogList layout={layout}>
            {Object.entries(TTS_ENGINES).map(([id, spec]) => {
                const result = engineChecks[id], { terms } = spec;
                const state = !result ? "unchecked" : result.pending ? "checking" : result.connected ? "connected" :
                    result.error_code === "tts_engine_url_invalid" ? "url_invalid" : "not_connected";
                // Laid out as a model's card: what it is and its state, its facts, its readout, its actions.
                return <li key={id} data-engine-card={id} role="group" aria-label={spec.name} className={styles.card}
                    data-status={inUse === id ? "in_use" : undefined}>
                    <div className={styles.card_intro}>
                        <div className={styles.card_head}>
                            <strong>{spec.name}</strong>
                            {layout === "list" && inUse === id && <span className={styles.badge} data-tone="in_use">{t("model_catalog.status.in_use")}</span>}
                            <span className={`${styles.badge} ${styles.status}`} data-tone={state}>{t(`model_catalog.engine.state.${state}`)}</span>
                        </div>
                        {/* In the grid "in use" is the line under the name, so the state ends the name's line on every card. */}
                        {layout === "grid" && inUse === id && <div className={styles.card_badges}>
                            <span className={styles.badge} data-tone="in_use">{t("model_catalog.status.in_use")}</span></div>}
                        <p>{t(`model_catalog.engine.summary.${id}`)}</p>
                    </div>
                    <CatalogFacts layout={layout}><dl className={`${styles.facts} ${styles.card_spec}`}>
                        <div><dt>{t("model_catalog.languages")}</dt><dd>{t("model_catalog.engine.languages")}</dd></div>
                        <div><dt>{t("model_catalog.engine.get")}</dt><dd>{t("model_catalog.engine.get_value")}</dd></div>
                        <div><dt>{t("model_catalog.engine.address")}</dt><dd><code>{address(spec)}</code></dd></div>
                    </dl></CatalogFacts>
                    <div className={styles.card_foot}>
                        <EnvReadout tone={state === "connected" ? "active" : state === "url_invalid" ? "failed" : state === "not_connected" ? "warning" : "neutral"}
                            progress={state === "checking" ? "working" : state === "connected" ? "done" : undefined}>
                            <p>{state === "unchecked" ? t("model_catalog.engine.state.unchecked") : state === "checking" ? t("voice_ui.engine.checking") :
                                state === "connected" ? t("voice_ui.engine.connected", { engine: spec.name, version: result?.version ?? "" }) :
                                    state === "url_invalid" ? t("voice_ui.errors.tts_engine_url_invalid") : t("voice_ui.engine.not_connected")}</p>
                        </EnvReadout>
                        {/* The button leads, so it is in the same place on every card; the links follow (#478). */}
                        <div className={styles.actions}>
                            <button type="button" disabled={state === "checking"} onClick={() => check(id, spec)}
                                aria-label={t("model_catalog.engine.recheck_of", { engine: spec.name })}>{t("voice_ui.engine.recheck")}</button>
                            <a className={styles.link_button} href={spec.site} target="_blank" rel="noreferrer" onClick={event => open(event, spec.site)}>
                                {t("voice_ui.engine.site", { engine: spec.name })}</a>
                            {terms && <a href={terms} target="_blank" rel="noreferrer" onClick={event => open(event, terms)}>{t("voice_ui.engine.terms")}</a>}
                        </div>
                    </div>
                </li>;
            })}
        </CatalogList>
    </section>;
};

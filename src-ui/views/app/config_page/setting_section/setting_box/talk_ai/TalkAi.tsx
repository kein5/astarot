import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import type { TFunction } from "i18next";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useI18n } from "@useI18n";
import { useStdoutToPython } from "@useStdoutToPython";
import { useTalkAi, useSaveButtonLogic } from "@logics_configs";
import { openai_auth_key_url } from "@ui_configs";
import { useVoice } from "../../../../../../logics/voice/useVoice";
import { useTalkAiSession } from "../../../../../../logics/talk_ai/useTalkAiSession.ts";
import type { TalkView } from "../../../../../../logics/talk_ai/useTalkAiSession.ts";
import {
    DETAIL_CHOICES, INTERVAL_CHOICES_MS, LONG_EDGE_CHOICES, SCREEN_SOURCES, choicesWith, errorKeys, isActive, isScreenSource, seconds, virtualMicDevice,
} from "../../../../../../logics/talk_ai/talkAi.ts";
import type { TalkKey, TalkProvider } from "../../../../../../logics/talk_ai/talkAi.ts";
import { SectionLabelComponent } from "../_components";
import { HintDescriptions } from "../_components/hint/Hint";
import { Lead } from "../_components/lead/Lead";
import { FormRow } from "../_components/form_row/FormRow";
import { PageLinkButton } from "../_components/page_pointer/PagePointer";
import { EntryWithSaveButtonContainer } from "../_templates/Templates";
import { CatalogFacts, CatalogLayoutSwitch, CatalogList, CatalogState, useCatalogLayout } from "../advanced_settings/catalogLayout";
import type { CatalogLayout } from "../advanced_settings/catalogLayout";
import * as catalogStyles from "../advanced_settings/VoiceSettings.css.ts";
import { Badge, Button, Card, CardFooter, CardHeader, CardTitle, Select, SelectOption, TextField } from "../../../../../kit/index.ts";
import { TalkAiConsentDialog, TalkAiScreenDialog } from "./TalkAiDialogs";
import * as styles from "./TalkAi.css.ts";

// The words of a code the core sent, or the general sentence with the code.
export const talkErrorText = (t: TFunction, code: string): string => t(errorKeys(code), { code });

// The page of Talk AI (#388, ADR-018), there only while its experimental feature is on (#969,
// decision 2). It starts with the choice the rest follows: whom to talk with, in the speech
// recognition page's order (decided on 2026-11-27, #1266 ★17): the local group and its server's
// address, then the API group and its key, each system's setting under its cards. Then the
// conversation, then the screen. Nothing is sent from here until
// the user starts a conversation and consents to it in the dialog; the screen has a consent of its
// own (talkAi.ts). While a conversation runs, the settings it was started with stay as they are:
// the core ends a conversation when one of them changes.
export const TalkAi = () => {
    const { t } = useI18n();
    const { asyncStdoutToPython } = useStdoutToPython();
    // Asked again when the page opens: the key may have been set, and the local address changed.
    useEffect(() => {
        for (const endpoint of ["/get/data/talk_ai_catalog", "/get/data/talk_ai_auth_key", "/get/data/talk_ai_screen_sources", "/get/data/talk_ai_status"]) {
            void asyncStdoutToPython(endpoint);
        }
    }, []);
    return (
        <HintDescriptions>
            <div className={styles.container} data-setting-id="talk_ai">
                <div>
                    <SectionLabelComponent label={t("talk_ai.section_label")} desc={t("talk_ai.intro")} />
                    {/* What leaves the PC, in a sentence that stays on screen (DESIGN.md "Principles"). */}
                    <Lead text={t("talk_ai.lead")} details={t("talk_ai.lead_details")} />
                </div>
                <Providers />
                <Conversation />
                <ScreenSharing />
            </div>
        </HintDescriptions>
    );
};

// The selected entry of the catalog; the first one until the saved choice is known.
const useSelected = (view: TalkView): TalkProvider | null => {
    const { currentTalkAiProvider } = useTalkAi();
    const catalog = view.catalog ?? [];
    return catalog.find(item => item.id === currentTalkAiProvider.data) ?? null;
};

// A conversation is open or being opened or closed: what it was started with is not changed then.
const useLocked = (view: TalkView) => isActive(view.status) || (view.pending !== null && view.pending !== "key");

const usable = (item: TalkProvider, key: TalkKey | null) => !item.cloud || key?.configured === true;

const Providers = () => {
    const { t } = useI18n();
    const { view } = useTalkAiSession();
    const layout = useCatalogLayout();
    const selected = useSelected(view);
    const catalog = view.catalog;
    return (
        <section className={catalogStyles.container} aria-label={t("talk_ai.providers.title")}>
            <div className={`${catalogStyles.catalog_head} ${catalogStyles.section_head}`}>
                <SectionLabelComponent label={t("talk_ai.providers.title")} desc={t("talk_ai.providers.intro")} />
                <CatalogLayoutSwitch />
            </div>
            {catalog === null
                ? <p>{t("talk_ai.providers.loading")}</p>
                : (["local", "api"] as const).map(group => {
                    const items = catalog.filter(item => item.cloud === (group === "api"));
                    if (items.length === 0) return null;
                    // Each system's setting under its cards, whichever is chosen: the key is set
                    // before an API is used (#1266 ★17). On the settings group's ground, so it
                    // ends on the page's right edge as the other rows do (#1233, #1266 K-2).
                    return <div key={group} data-catalog-group={group}>
                        <SectionLabelComponent sub label={t(`talk_ai.providers.group.${group}`)} desc={t(`talk_ai.providers.group_help.${group}`)} />
                        <CatalogList layout={layout}>
                            {items.map(item => <ProviderCard key={item.id} item={item} selected={selected?.id === item.id} layout={layout} />)}
                        </CatalogList>
                        <div data-settings-group>{group === "api" ? <KeyRow /> : <LocalUrlRow />}</div>
                    </div>;
                })}
        </section>
    );
};

const ProviderCard = ({ item, selected, layout }: { item: TalkProvider; selected: boolean; layout: CatalogLayout }) => {
    const { t } = useI18n();
    const { view } = useTalkAiSession();
    const { currentTalkAiProvider, setTalkAiProvider } = useTalkAi();
    const locked = useLocked(view);
    const ready = usable(item, view.key);
    const state = selected ? (ready ? "in_use" : "not_set") : (ready ? "ready" : "not_set");
    const badges = <>
        <Badge>{t(item.cloud ? "talk_ai.badge.cloud" : "talk_ai.badge.local")}</Badge>
        <Badge tone={item.vision ? "active" : undefined}>{t(item.vision ? "talk_ai.badge.vision" : "talk_ai.badge.voice_only")}</Badge>
    </>;
    return <Card as="li" data-catalog-item={item.id} active={selected} data-status={state} role="group" aria-label={item.name}>
        <CardHeader><div className={catalogStyles.card_head}>
            <CardTitle>{item.name}</CardTitle>
            {layout === "list" && badges}
            <CatalogState state={state}>{t(`talk_ai.state.${state}`)}</CatalogState>
        </div>
        {layout === "grid" && <div className={catalogStyles.card_badges}>{badges}</div>}
        </CardHeader>
        <CatalogFacts layout={layout}><dl className={catalogStyles.facts}>
            <div><dt>{t("talk_ai.fact.destination")}</dt><dd><code>{item.destination}</code></dd></div>
            <div><dt>{t("talk_ai.fact.input")}</dt><dd>{t(item.vision ? "talk_ai.fact.input_vision" : "talk_ai.fact.input_voice")}</dd></div>
            {item.recommended_model && <div><dt>{t("talk_ai.fact.model")}</dt><dd>{item.recommended_model}</dd></div>}
            {item.minimum_gpu_memory_gib !== null && <div><dt>{t("talk_ai.fact.gpu")}</dt>
                <dd>{t("talk_ai.fact.gpu_value", { minimum: item.minimum_gpu_memory_gib, recommended: item.recommended_gpu_memory_gib ?? item.minimum_gpu_memory_gib })}</dd></div>}
            {/* Where the key is kept, once there is one: a missing key is the card's state (#1266 K-5). */}
            {item.cloud && view.key?.configured && <div><dt>{t("talk_ai.fact.key")}</dt><dd>{t(keyState(view.key))}</dd></div>}
            {item.cloud && <div><dt>{t("talk_ai.fact.cost")}</dt><dd>{t("talk_ai.fact.cost_value")}</dd></div>}
        </dl></CatalogFacts>
        {/* A missing key is said by the card's state and by why Start waits, not again here (#1266 K-5). */}
        {!selected && <CardFooter>
            <div className={catalogStyles.actions}>
                <Button tone="primary" disabled={locked || currentTalkAiProvider.state === "pending"}
                    onClick={() => void setTalkAiProvider(item.id)}>{t("talk_ai.use")}</Button>
            </div>
        </CardFooter>}
    </Card>;
};

const keyState = (key: TalkKey | null): string => key === null ? "common.loading"
    : !key.configured ? "talk_ai.key.none" : key.stored ? "talk_ai.key.stored" : "talk_ai.key.memory";

// The OpenAI key. It is only written: the core never gives it back, so the field starts empty and
// the line under the label says where a kept one is. It saves by itself (#1111, #1266 K-1): Enter,
// or focus leaving the field, keeps what was typed; Remove forgets the kept key. Both end a
// conversation in progress, so they wait until it ends.
const KeyRow = () => {
    const { t } = useI18n();
    const { view, setKey } = useTalkAiSession();
    const [value, setValue] = useState("");
    const locked = useLocked(view);
    const busy = view.pending === "key";
    const keyError = view.error?.endpoint === "/set/data/talk_ai_auth_key" ? view.error.code : null;
    const save = () => {
        const key = value.trim();
        if (!key || busy || locked) return;
        setValue("");
        void setKey(key);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") { event.preventDefault(); save(); }
        if (event.key === "Escape") setValue("");
    };
    const openKeyPage = () => { if (isTauri()) void openUrl(openai_auth_key_url).catch(() => {}); };
    // Where a kept key is; no key is said by the cards' state and by Start (#1266 K-5).
    return <FormRow label={t("talk_ai.key.label")} description={t("talk_ai.key.desc")} status={view.key?.configured ? t(keyState(view.key)) : undefined}
        actions={<div className={catalogStyles.actions}>
            {view.key?.configured && <Button tone="danger" disabled={busy || locked} onClick={() => void setKey(null)}>{t("talk_ai.key.remove")}</Button>}
            <Button onClick={openKeyPage}>{t("config_page.common.open_auth_key_webpage")}</Button>
            {keyError && <p role="alert" className={styles.problem}>{talkErrorText(t, keyError)}</p>}
        </div>}>
        <TextField type="password" mono autoComplete="off" spellCheck={false} value={value} readOnly={busy || locked}
            placeholder={t(view.key?.configured ? "talk_ai.key.placeholder_replace" : "talk_ai.key.placeholder")}
            onChange={event => setValue(event.target.value)} onKeyDown={onKeyDown} onBlur={save} />
    </FormRow>;
};

// The address of the user's vLLM-Omni server. It saves by itself (#1111); a refused address is
// said under the field. It is read-only while a conversation runs.
const LocalUrlRow = () => {
    const { t } = useI18n();
    const { view } = useTalkAiSession();
    const { currentTalkAiLocalUrl, setTalkAiLocalUrl } = useTalkAi();
    const locked = useLocked(view);
    const { variable, onChangeFunction, saveFunction, leaveFunction, revert, error } = useSaveButtonLogic({
        variable: currentTalkAiLocalUrl.data,
        state: currentTalkAiLocalUrl.state,
        setFunction: setTalkAiLocalUrl,
        endpoint: "/set/data/talk_ai_local_url",
    });
    return <EntryWithSaveButtonContainer
        setting_id="talk_ai.local_url"
        label={t("talk_ai.local_url.label")}
        desc={t("talk_ai.local_url.desc")}
        variable={typeof variable === "string" ? variable : ""}
        state={locked ? "pending" : currentTalkAiLocalUrl.state}
        onChangeFunction={onChangeFunction}
        saveFunction={saveFunction}
        leaveFunction={leaveFunction}
        onRevert={revert}
        error={error}
        remove_border_bottom={true}
    />;
};

// The phase of the conversation, in words, with the reason it stopped.
const statusText = (t: TFunction, view: TalkView, name: string): string => {
    const { status } = view;
    if (view.pending === "start") return t("talk_ai.status.starting", { name });
    if (view.pending === "stop") return t("talk_ai.status.stopping");
    if (status.phase === "connecting") return t("talk_ai.status.connecting", { name });
    if (status.phase === "ready") return t(status.screen_source ? "talk_ai.status.ready_screen" : "talk_ai.status.ready", { name });
    if (status.phase === "failed") return t("talk_ai.status.failed", { reason: status.error ? talkErrorText(t, status.error) : t("talk_ai.errors.other", { code: "-" }) });
    return t("talk_ai.status.idle");
};

// Starting, ending and steering a conversation, and where its answer is played.
const Conversation = () => {
    const { t } = useI18n();
    const { view, stop, interrupt, endTurn, setOutput } = useTalkAiSession();
    const { settings } = useVoice();
    const selected = useSelected(view);
    const [consenting, setConsenting] = useState(false);
    const active = isActive(view.status);
    const locked = useLocked(view);
    const virtualMic = virtualMicDevice(settings);
    const ready = selected !== null && usable(selected, view.key);
    // A refusal of starting or of the voice is said here; the key's and the screen's at their rows.
    const startError = view.error && ["/set/enable/talk_ai", "/set/enable/talk_ai_audio", "/set/disable/talk_ai"].includes(view.error.endpoint) ? view.error.code : null;
    return (
        <section className={styles.section} aria-label={t("talk_ai.conversation.title")}>
            <SectionLabelComponent label={t("talk_ai.conversation.title")} />
            <p role="status" className={styles.status} data-phase={view.status.phase}>{statusText(t, view, selected?.name ?? "")}</p>
            {/* The core ends a conversation when what it started with changes; those controls wait. */}
            {active && <p className={styles.note}>{t("talk_ai.locked")}</p>}
            <FormRow label={t("talk_ai.output.label")} description={t("talk_ai.output.desc")}>
                <Select value={view.output} disabled={locked} onChange={event => setOutput(event.target.value === "virtual_mic" ? "virtual_mic" : "headphones")}>
                    <SelectOption value="headphones">{t("talk_ai.output.headphones")}</SelectOption>
                    <SelectOption value="virtual_mic" disabled={!virtualMic}>{t("talk_ai.output.virtual_mic")}</SelectOption>
                </Select>
            </FormRow>
            {!virtualMic && <div className={styles.note}>
                <p>{t("talk_ai.output.virtual_mic_missing")}</p>
                <PageLinkButton tab="tts" />
            </div>}
            {/* In the control column, aligned to the rows' right end (#473, #1096, #1266 K-3). */}
            <div className={`${catalogStyles.actions} ${catalogStyles.control_column}`}>
                <Button tone="primary" disabled={!ready || locked} onClick={() => setConsenting(true)}>{t("talk_ai.start")}</Button>
                <Button tone="quiet" disabled={!active || view.pending === "stop"} onClick={() => void stop()}>{t("talk_ai.stop")}</Button>
                {active && view.status.phase === "ready" && <Button onClick={() => void interrupt()}>{t("talk_ai.interrupt")}</Button>}
                {active && view.status.phase === "ready" && selected && !selected.cloud &&
                    <Button onClick={() => void endTurn()}>{t("talk_ai.end_turn")}</Button>}
            </div>
            {/* What a disabled Start waits for, under it in the control column (#1096). */}
            {!ready && selected && <p className={`${styles.reason} ${catalogStyles.control_column}`}>{t("talk_ai.start_needs_key")}</p>}
            {selected && !selected.cloud && <p className={styles.note}>{t("talk_ai.end_turn_help")}</p>}
            {startError && <p role="alert" className={styles.problem}>{talkErrorText(t, startError)}</p>}
            {consenting && selected && <TalkAiConsentDialog provider={selected} output={view.output} device={view.output === "virtual_mic" ? virtualMic : null}
                onClose={() => setConsenting(false)} />}
        </section>
    );
};

// Showing the screen: where it is taken from, how often and how large, and the consent of its own.
const ScreenSharing = () => {
    const { t } = useI18n();
    const { view, stopScreen, setSource } = useTalkAiSession();
    const { currentTalkAiScreenIntervalMs, setTalkAiScreenIntervalMs, currentTalkAiScreenLongEdge, setTalkAiScreenLongEdge,
        currentTalkAiScreenDetail, setTalkAiScreenDetail } = useTalkAi();
    const selected = useSelected(view);
    const [consenting, setConsenting] = useState(false);
    const locked = useLocked(view);
    const vision = selected?.vision === true;
    const sharing = view.status.screen_source !== null || view.screen !== null;
    const canShare = vision && view.status.phase === "ready" && view.pending === null && !sharing;
    const sources = view.sources.length > 0 ? view.sources : [...SCREEN_SOURCES];
    const intervals = choicesWith(INTERVAL_CHOICES_MS, currentTalkAiScreenIntervalMs.data, "interval");
    const edges = choicesWith(LONG_EDGE_CHOICES, currentTalkAiScreenLongEdge.data, "edge");
    const screenError = view.error && ["/set/enable/talk_ai_screen", "/set/disable/talk_ai_screen"].includes(view.error.endpoint) ? view.error.code : null;
    return (
        <section className={styles.section} aria-label={t("talk_ai.screen.title")}>
            <SectionLabelComponent label={t("talk_ai.screen.title")} desc={t("talk_ai.screen.intro")} />
            {selected && !vision && <p className={styles.note}>{t("talk_ai.screen.no_vision", { name: selected.name })}</p>}
            <FormRow label={t("talk_ai.screen.source.label")} description={t("talk_ai.screen.source.desc")}>
                <Select value={view.source} disabled={!vision || sharing} onChange={event => { if (isScreenSource(event.target.value)) setSource(event.target.value); }}>
                    {sources.map(source => <SelectOption key={source} value={source}>{t(`talk_ai.screen.source.${source}`)}</SelectOption>)}
                </Select>
            </FormRow>
            <FormRow label={t("talk_ai.screen.interval.label")} description={t("talk_ai.screen.interval.desc")}>
                <Select value={String(currentTalkAiScreenIntervalMs.data)} disabled={locked || currentTalkAiScreenIntervalMs.state === "pending"}
                    onChange={event => void setTalkAiScreenIntervalMs(Number(event.target.value))}>
                    {intervals.map(ms => <SelectOption key={ms} value={String(ms)}>
                        {t(ms === 1000 ? "talk_ai.screen.interval.default" : "talk_ai.screen.interval.value", { seconds: seconds(ms) })}</SelectOption>)}
                </Select>
            </FormRow>
            <FormRow label={t("talk_ai.screen.long_edge.label")} description={t("talk_ai.screen.long_edge.desc")}>
                <Select value={String(currentTalkAiScreenLongEdge.data)} disabled={locked || currentTalkAiScreenLongEdge.state === "pending"}
                    onChange={event => void setTalkAiScreenLongEdge(Number(event.target.value))}>
                    {edges.map(px => <SelectOption key={px} value={String(px)}>
                        {t(px === 1024 ? "talk_ai.screen.long_edge.default" : "talk_ai.screen.long_edge.value", { px })}</SelectOption>)}
                </Select>
            </FormRow>
            <FormRow label={t("talk_ai.screen.detail.label")} description={t("talk_ai.screen.detail.desc")}>
                <Select value={String(currentTalkAiScreenDetail.data)} disabled={locked || currentTalkAiScreenDetail.state === "pending"}
                    onChange={event => void setTalkAiScreenDetail(event.target.value)}>
                    {DETAIL_CHOICES.map(detail => <SelectOption key={detail} value={detail}>{t(`talk_ai.screen.detail.${detail}`)}</SelectOption>)}
                </Select>
            </FormRow>
            <div className={`${catalogStyles.actions} ${catalogStyles.control_column}`}>
                <Button tone="primary" disabled={!canShare} onClick={() => setConsenting(true)}>{t("talk_ai.screen.start")}</Button>
                {sharing && <Button tone="quiet" disabled={view.pending === "stop"} onClick={() => void stopScreen()}>{t("talk_ai.screen.stop")}</Button>}
            </div>
            {vision && view.status.phase !== "ready" && <p className={`${styles.reason} ${catalogStyles.control_column}`}>{t("talk_ai.screen.needs_conversation")}</p>}
            {screenError && <p role="alert" className={styles.problem}>{talkErrorText(t, screenError)}</p>}
            {consenting && selected && <TalkAiScreenDialog provider={selected} source={view.source}
                interval={Number(currentTalkAiScreenIntervalMs.data)} edge={Number(currentTalkAiScreenLongEdge.data)} onClose={() => setConsenting(false)} />}
        </section>
    );
};

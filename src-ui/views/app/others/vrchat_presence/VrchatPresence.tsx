import { useEffect, useRef } from "react";
import { useI18n } from "@useI18n";
import { useAdvancedSettings, useOthers } from "@logics_configs";
import { EnvReadout } from "../../config_page/setting_section/setting_box/_components/env_readout/EnvReadout";
import type { EnvReadoutTone } from "../../config_page/setting_section/setting_box/_components/env_readout/EnvReadout";

const ANSWERS = ["found", "not_found", "unknown"] as const;
type PresenceState = typeof ANSWERS[number] | "checking";
const isAnswer = (value: unknown): value is typeof ANSWERS[number] => ANSWERS.some(answer => answer === value);
const TONES: Partial<Record<PresenceState, EnvReadoutTone>> = { found: "active", not_found: "warning" };

// "Sent" in the log only means the message left: VRChat does not answer. A
// VRChat on this PC advertises OSC while its OSC is enabled, and the app can
// see that. This says it in words: found, not found (with the step that turns
// OSC on), or that this PC cannot tell. It asks again every few seconds while
// it is on screen, so starting VRChat or enabling OSC shows up by itself.
// useVrchatPresence gives the words and their tone, for a place that draws them its own way (the
// first-run setup's list, #557); VrchatPresence draws them as an environment readout.
// What the readout says: the presence answer, or why it is not asked.
export type VrchatPresenceState = PresenceState | "sending_off" | "osc_query_off";

export const useVrchatPresence = (): { state: VrchatPresenceState; tone: EnvReadoutTone; lines: string[] } => {
    const { t } = useI18n();
    const { currentVrchatOscPresence, getVrchatOscPresence, currentEnableSendMessageToVrc } = useOthers();
    const { currentEnableOscQuery } = useAdvancedSettings();
    // The hook hands out a new function on every render; keep the latest without restarting the timer.
    const ask = useRef(getVrchatOscPresence);
    ask.current = getVrchatOscPresence;
    const sends = currentEnableSendMessageToVrc.data !== false;
    // OSCQuery turned off (#559): the backend can only answer "unknown", so it is not asked.
    const osc_query_off = currentEnableOscQuery.data === false;
    useEffect(() => {
        if (!sends || osc_query_off) return;
        ask.current();
        const timer = setInterval(() => ask.current(), 5000);
        return () => clearInterval(timer);
    }, [sends, osc_query_off]);
    if (!sends) return { state: "sending_off", tone: "neutral", lines: [t("vrchat_presence.sending_off")] };
    if (osc_query_off) return { state: "osc_query_off", tone: "neutral", lines: [t("vrchat_presence.osc_query_off")] };
    const answer = currentVrchatOscPresence.data;
    const state: PresenceState = isAnswer(answer) ? answer : "checking";
    return { state, tone: TONES[state] ?? "neutral",
        lines: [t(`vrchat_presence.${state}`), ...(state === "not_found" ? [t("vrchat_presence.not_found_hint")] : [])] };
};

export const VrchatPresence = ({ className }: { className?: string }) => {
    const { tone, lines } = useVrchatPresence();
    return (
        <EnvReadout className={className} tone={tone}>
            {lines.map(line => <p key={line}>{line}</p>)}
        </EnvReadout>
    );
};

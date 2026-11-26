import { isActive, readStatus, IDLE_STATUS } from "./talkAi.ts";
import type { AnswerOutput, AudioChoice, ScreenSource, TalkKey, TalkProvider, TalkStatus } from "./talkAi.ts";

// The Talk AI conversation as the UI sees it (talkAi.ts says the order the core asks for). The
// session lives in the core; this keeps what the core last said of it, the request waiting for
// its answer, and what is to start once the indicator above the pages shows it.

export const START = "/set/enable/talk_ai";
export const STOP = "/set/disable/talk_ai";
export const AUDIO = "/set/enable/talk_ai_audio";
export const SCREEN = "/set/enable/talk_ai_screen";
export const SCREEN_STOP = "/set/disable/talk_ai_screen";
export const KEY = "/set/data/talk_ai_auth_key";
export const STATUS = "/get/data/talk_ai_status";

export type TalkRequest = "start" | "stop" | "audio" | "screen" | "key";

export interface TalkView {
    catalog: TalkProvider[] | null;
    key: TalkKey | null;
    sources: ScreenSource[];
    status: TalkStatus;
    // The last refusal or failure, with the request it answered (an endpoint), for the page.
    error: { code: string; endpoint: string } | null;
    pending: TalkRequest | null;
    // Whom the open conversation is with: the entry chosen when it started. The status does not say.
    partner: { id: string; name: string } | null;
    // The voice to start once the session is ready and the indicator says so.
    audio: AudioChoice | null;
    // The screen to share once the indicator says so; `sent` once it was asked for.
    screen: { source: ScreenSource; destination: string; sent: boolean } | null;
    // The page's choices for the next start. Not saved: every start begins on the user's own
    // output (#969, decision 3), and the screen source is confirmed in the sharing consent.
    output: AnswerOutput;
    source: ScreenSource;
}

export const INITIAL_VIEW: TalkView = Object.freeze({
    catalog: null, key: null, sources: [], status: IDLE_STATUS, error: null, pending: null, partner: null,
    audio: null, screen: null, output: "headphones", source: "window",
});

// The view after a status: what waited for a session that ended is dropped with it. A start still
// waiting for its answer keeps its voice: an older poll may say "idle" before the answer comes.
// When a conversation ends, the answer goes back to the user's own output for the next one
// (#969, decision 3: the virtual microphone is chosen for a conversation, not kept).
export const withStatus = (view: TalkView, value: unknown): TalkView => {
    const status = readStatus(value);
    if (isActive(status) || view.pending === "start") return { ...view, status };
    const ended = isActive(view.status);
    return { ...view, status, partner: null, audio: null, screen: null, output: ended ? "headphones" : view.output };
};

// The view after the answer to the request that waited.
export const answered = (view: TalkView, value: unknown): TalkView => ({ ...withStatus({ ...view, pending: null }, value) });

// The view after a refusal of `endpoint`.
export const refused = (view: TalkView, code: string, endpoint: string): TalkView => ({
    ...view,
    pending: null,
    error: { code, endpoint },
    audio: endpoint === START || endpoint === AUDIO ? null : view.audio,
    partner: endpoint === START && !isActive(view.status) ? null : view.partner,
    screen: endpoint === SCREEN ? null : view.screen,
});

// The atoms and setters the usage data switch reads (see AdvancedSettings).
export type TelemetryValue = { state?: string; data?: unknown } | null | undefined;
export type TelemetryNoticeValue = { state?: string; data?: { pending?: unknown } | null } | null | undefined;
export type TelemetryToggleInput<Result> = {
    currentTelemetry: TelemetryValue;
    currentTelemetryNotice: TelemetryNoticeValue;
    toggleTelemetry: () => Result;
    setTelemetryNotice: (answer: { send: true }) => unknown;
    getTelemetry: () => unknown;
};

// The one-time notice is not answered yet. Nothing is sent then, whatever ENABLE_TELEMETRY says:
// the backend sends only once the setting is on, the notice answered and VRCT_TELEMETRY is not
// "off" (native/core/src/controller/telemetry.rs).
export const telemetryUnanswered = (notice: TelemetryNoticeValue): boolean => notice?.data?.pending === true;

// What the switch shows. ENABLE_TELEMETRY starts true, so before the notice is answered the
// switch looked on although nothing was sent. Until the answer it shows off, as sending is.
// While the answer given here is on its way, the switch waits as it does for its own requests.
export const shownTelemetry = (telemetry: TelemetryValue, notice: TelemetryNoticeValue): TelemetryValue => {
    const shown = telemetryUnanswered(notice) ? { ...telemetry, data: false } : telemetry;
    return notice?.state === "pending" ? { ...shown, state: "pending" } : shown;
};

// The usage data switch on the settings page (Settings → Advanced).
//
// The backend starts sending only from the answer to the one-time notice (SEC-07):
// /set/enable/telemetry alone is not consent. While the notice is unanswered the switch shows
// off, so pressing it means "send": that answer is sent ("send"), and this page shows what is
// sent, as the notice does. After the answer it is the usual switch; turning it off answers too.
export const toggleTelemetryOrAnswer = <Result>({ currentTelemetryNotice, toggleTelemetry, setTelemetryNotice, getTelemetry }: TelemetryToggleInput<Result>): Result | Promise<unknown> => {
    if (telemetryUnanswered(currentTelemetryNotice)) {
        return Promise.resolve(setTelemetryNotice({ send: true })).then(() => getTelemetry());
    }
    return toggleTelemetry();
};

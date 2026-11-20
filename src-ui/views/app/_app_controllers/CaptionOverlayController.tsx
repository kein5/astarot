import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useStore_MessageLogs, useStore_SpeakerNames } from "@store";
import { useI18n } from "@useI18n";
import { useIsBackendReady, useNotificationStatus } from "@logics_common";
import { useAppearance, useVr, useExperimentalFeature } from "@logics_configs";
import { captionLines, stampLines } from "../../../logics/captionOverlay/lines";
import type { CaptionSnapshot, CaptionStamp } from "../../../logics/captionOverlay/lines";
import { placementOf, steppedFontSize } from "../../../logics/captionOverlay/adjust";
import { useIoFlow } from "../../../logics/flow/useIoFlow";
import { overlayCount } from "../../../logics/flow/ioFlow.ts";
import { flowNote, stripItems } from "../../../logics/flow/flowText.ts";
import { failureRun, windowFailureKey } from "../../../logics/common/windowFailures.ts";
import type { FailureRun, WindowStep } from "../../../logics/common/windowFailures.ts";

// Where the native side says the window was dropped; placementOf checks it.
type DroppedPlacement = { x?: unknown; y?: unknown } | null;

// stampLines gives every line it was given a stamp; one missing stops here, as reading the
// time of a missing stamp did.
const stampOf = (stamps: ReadonlyMap<string, CaptionStamp>, id: string): CaptionStamp => {
    const stamp = stamps.get(id);
    if (!stamp) throw new TypeError("a caption line has no stamp");
    return stamp;
};

// Captions over the desktop: opens the overlay window while the setting is on
// and hands it the last rows of the message log. The window only draws; what
// it shows and for how long is decided here. The flow strip (where the user's
// latest inputs went, in ms) shares the window and can be on without captions.
// With Ctrl held the user drags the window and changes its text size; the
// native side reports both and they are saved here.
export const CaptionOverlayController = () => {
    const { t } = useI18n();
    const { currentIsEnabledOverlayDesktop, currentOverlayDesktopSettings, currentOverlayShowOnlyTranslatedMessages,
        currentIoFlowOverlaySettings, currentOverlayDesktopPlacement, setOverlayDesktopSettings,
        setOverlayDesktopPlacement } = useVr();
    const { currentMessageLogs } = useStore_MessageLogs();
    const { currentSpeakerNames } = useStore_SpeakerNames();
    // The tray companion (an experimental feature) has no window of its own to show captions in.
    const trayCompanion = useExperimentalFeature("tray_companion");
    const { currentSelectedFontFamily } = useAppearance();
    const { currentIsBackendReady } = useIsBackendReady();
    const { currentIoFlow, currentIoTraces } = useIoFlow();
    const { showNotification_Error } = useNotificationStatus();
    const [supported, setSupported] = useState(false);
    const stamps = useRef<ReadonlyMap<string, CaptionStamp> | null>(null);
    // A window that cannot be opened or updated is said once, until it works again (#397).
    const failures = useRef<Record<WindowStep, FailureRun> | null>(null);
    // Made once; every render reads the same runs of failures.
    failures.current ??= { open: failureRun(), update: failureRun() };
    const failure = failures.current;
    const notifyFailure = (step: WindowStep, error: unknown) => failure[step].failed(() => showNotification_Error(
        t(windowFailureKey("caption_overlay", step, error)), { category_id: `caption_overlay_${step}_failed` }));

    useEffect(() => {
        let disposed = false;
        invoke("caption_overlay_supported").then(value => { if (!disposed) setSupported(value === true); }, () => {});
        return () => { disposed = true; };
    }, []);

    const ready = supported && currentIsBackendReady.data === true;
    // While it is on, the captions are on too, without changing the saved setting.
    const captions = ready && (currentIsEnabledOverlayDesktop.data === true || trayCompanion);
    const flowShown = ready && currentIoFlowOverlaySettings.data?.desktop === true;
    const enabled = captions || flowShown;
    const settings = currentOverlayDesktopSettings.data;
    const count = overlayCount(currentIoFlowOverlaySettings.data);
    const placement = placementOf(currentOverlayDesktopPlacement?.data);

    useEffect(() => {
        if (!supported) return;
        invoke("caption_overlay_set", { open: enabled, position: settings.position, placement })
            .then(() => failure.open.succeeded(), error => {
                console.error("Caption overlay window could not be changed", error);
                // Closing a window that is gone needs no notice; opening one that fails does.
                if (enabled) notifyFailure("open", error);
            });
    }, [supported, enabled, settings.position, placement?.x, placement?.y]);

    // A step starts from the last size asked for while the backend has not confirmed it, so
    // quick presses each count. A confirmed size drops the requests up to it; a size changed
    // some other way (the slider, a reset) drops them all.
    const newest = { settings, setOverlayDesktopSettings, setOverlayDesktopPlacement };
    const latest = useRef(newest);
    const asked = useRef<{ seen: number; sizes: number[] }>({ seen: settings.font_size, sizes: [] });
    if (asked.current.seen !== settings.font_size) {
        const confirmed = asked.current.sizes.indexOf(settings.font_size);
        asked.current = { seen: settings.font_size, sizes: confirmed < 0 ? [] : asked.current.sizes.slice(confirmed + 1) };
    }
    latest.current = newest;
    useEffect(() => {
        if (!supported) return undefined;
        const offs = [
            listen<DroppedPlacement>("caption-overlay-moved", ({ payload }) => {
                const dropped = placementOf(payload);
                if (dropped) latest.current.setOverlayDesktopPlacement(dropped);
            }),
            listen("caption-overlay-font-step", ({ payload }) => {
                const { settings: current, setOverlayDesktopSettings: save } = latest.current;
                const from = asked.current.sizes.at(-1) ?? current.font_size;
                const next = steppedFontSize(from, payload);
                if (next === from) return;
                asked.current.sizes.push(next);
                save({ ...current, font_size: next });
            }),
        ];
        return () => offs.forEach(off => off.then(stop => stop(), () => {}));
    }, [supported]);

    useEffect(() => {
        if (!enabled) {
            stamps.current = null;
            return;
        }
        const lines = captions
            ? captionLines(currentMessageLogs.data, {
                onlyTranslated: currentOverlayShowOnlyTranslatedMessages.data === true, speakerNames: currentSpeakerNames.data,
            })
            : [];
        const stamped = stampLines(stamps.current, lines, Date.now(), settings.display_duration * 1000);
        stamps.current = stamped;
        const snapshot: CaptionSnapshot = {
            lines: lines.map(line => ({ ...line, until: stampOf(stamped, line.id).until })),
            position: settings.position, font_size: settings.font_size, opacity: settings.opacity,
            font_family: currentSelectedFontFamily.data,
            ...(flowShown ? { flow: stripItems(currentIoTraces.data, count, t), flow_note: flowNote(currentIoFlow.data, t) } : {}),
        };
        invoke("caption_overlay_update", { snapshot }).then(() => failure.update.succeeded(), error => {
            // The error is a code or a system message, never the captions themselves.
            console.error("Caption overlay could not be updated", error);
            notifyFailure("update", error);
        });
    }, [enabled, captions, flowShown, count, currentMessageLogs.data, currentSpeakerNames.data, currentOverlayShowOnlyTranslatedMessages.data,
        settings.position, settings.font_size, settings.opacity, settings.display_duration, currentSelectedFontFamily.data,
        currentIoTraces.data, currentIoFlow.data?.conversion_round_trip_ms, t]);

    return null;
};

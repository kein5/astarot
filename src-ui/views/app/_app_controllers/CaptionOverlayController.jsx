import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useStore_MessageLogs } from "@store";
import { useI18n } from "@useI18n";
import { useIsBackendReady } from "@logics_common";
import { useAppearance, useVr, useExperimentalFeature } from "@logics_configs";
import { captionLines, stampLines } from "../../../logics/captionOverlay/lines";
import { placementOf, steppedFontSize } from "../../../logics/captionOverlay/adjust";
import { useIoFlow } from "../../../logics/flow/useIoFlow";
import { overlayCount } from "../../../logics/flow/ioFlow.ts";
import { flowNote, stripItems } from "../../../logics/flow/flowText.ts";

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
    // The tray companion (an experimental feature) has no window of its own to show captions in.
    const trayCompanion = useExperimentalFeature("tray_companion");
    const { currentSelectedFontFamily } = useAppearance();
    const { currentIsBackendReady } = useIsBackendReady();
    const { currentIoFlow, currentIoTraces } = useIoFlow();
    const [supported, setSupported] = useState(false);
    const stamps = useRef(null);

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
            .catch(error => console.error("Caption overlay window could not be changed", error));
    }, [supported, enabled, settings.position, placement?.x, placement?.y]);

    // A step starts from the last size asked for while the backend has not confirmed it, so
    // quick presses each count. A confirmed size drops the requests up to it; a size changed
    // some other way (the slider, a reset) drops them all.
    const latest = useRef(null);
    const asked = useRef({ seen: settings.font_size, sizes: [] });
    if (asked.current.seen !== settings.font_size) {
        const confirmed = asked.current.sizes.indexOf(settings.font_size);
        asked.current = { seen: settings.font_size, sizes: confirmed < 0 ? [] : asked.current.sizes.slice(confirmed + 1) };
    }
    latest.current = { settings, setOverlayDesktopSettings, setOverlayDesktopPlacement };
    useEffect(() => {
        if (!supported) return undefined;
        const offs = [
            listen("caption-overlay-moved", ({ payload }) => {
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
            ? captionLines(currentMessageLogs.data, { onlyTranslated: currentOverlayShowOnlyTranslatedMessages.data === true })
            : [];
        stamps.current = stampLines(stamps.current, lines, Date.now(), settings.display_duration * 1000);
        invoke("caption_overlay_update", { snapshot: {
            lines: lines.map(line => ({ ...line, until: stamps.current.get(line.id).until })),
            position: settings.position, font_size: settings.font_size, opacity: settings.opacity,
            font_family: currentSelectedFontFamily.data,
            ...(flowShown ? { flow: stripItems(currentIoTraces.data, count, t), flow_note: flowNote(currentIoFlow.data, t) } : {}),
        } }).catch(error => console.error("Caption overlay could not be updated", error));
    }, [enabled, captions, flowShown, count, currentMessageLogs.data, currentOverlayShowOnlyTranslatedMessages.data,
        settings.position, settings.font_size, settings.opacity, settings.display_duration, currentSelectedFontFamily.data,
        currentIoTraces.data, currentIoFlow.data?.conversion_round_trip_ms, t]);

    return null;
};

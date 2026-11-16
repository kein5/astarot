import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@useI18n";
import { companionBridge, type CompanionBridge, type HandleCentre } from "../../logics/companion/bridge.ts";
import { actionFor, FEATURES, type CompanionStatus, type Feature } from "../../logics/companion/status.ts";
import { dockAnchor, innerHexagon, pointAngle, pointTriangle, polygon } from "../../logics/companion/hexagram.ts";
import * as styles from "./CompanionHandle.css.ts";
import { FROM_X, FROM_Y } from "./CompanionHandle.css.ts";

// The handle beside the captions in the tray companion (experimental feature "tray_companion",
// Issue #355): a magic circle around a hexagram, the shape of the ASTAROT symbol. At rest it is
// small and faint, and the points of the features that are on are filled. Under the pointer the
// window grows around it (companion_handle_open) and the star with it; hovering one of the six
// triangles docks that feature out beyond its point, and pressing the docked label toggles it
// with the main window's own switch. Hovering alone changes nothing. The hexagon in the middle
// opens the control panel. The window never takes the focus.

// The star is drawn at its open size and scaled down at rest (CSS px).
export const OPEN_RADIUS = 58;
const REST_RADIUS = 15;
const REST_CENTRE: HandleCentre = { x: 20, y: 20 };
// How far beyond the centre a feature docks out.
const DOCK_DISTANCE = OPEN_RADIUS + 16;
// The pointer left: wait a moment, so a slip across the edge does not close it.
export const CLOSE_DELAY_MS = 250;
// The pointer stopped over the open handle (or left without the page noticing): close anyway.
export const IDLE_CLOSE_MS = 6000;

// The same words as the main window's switches.
const LABEL_KEYS: Record<Feature, string> = {
    mic: "main_page.transcription_send",
    translation: "main_page.translation",
    tts: "main_page.tts",
    rvc: "main_page.rvc",
    listening: "main_page.transcription_receive",
    ocr: "main_page.ocr",
};

export const CompanionHandle = ({ bridge = companionBridge }: { bridge?: CompanionBridge }) => {
    const { t, i18n } = useI18n();
    const [status, setStatus] = useState<CompanionStatus | null>(null);
    const [open, setOpen] = useState(false);
    const [centre, setCentre] = useState<HandleCentre>(REST_CENTRE);
    const [docked, setDocked] = useState<Feature | null>(null);
    // The state last asked of the window, so that a late answer does not undo a newer request.
    const wanted = useRef(false);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        let disposed = false;
        const refresh = async () => {
            try {
                const next = await bridge.status();
                if (disposed) return;
                if (next.language !== i18n.language) await i18n.changeLanguage(next.language);
                setStatus(next);
            } catch (error) { console.warn("Companion handle could not read the state", error); }
        };
        const changed = bridge.onChanged(() => { void refresh(); });
        changed.then(refresh, () => {});
        return () => { disposed = true; changed.then(off => off(), () => {}); };
    }, [bridge]);

    const clear = (timer: { current: ReturnType<typeof setTimeout> | null }) => {
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = null;
    };
    useEffect(() => () => { clear(closeTimer); clear(idleTimer); }, []);

    const setHandleOpen = async (next: boolean) => {
        if (wanted.current === next) return;
        wanted.current = next;
        try {
            const at = await bridge.openHandle(next);
            if (wanted.current !== next) return;
            setCentre(at);
            setOpen(next);
            if (!next) setDocked(null);
        } catch (error) {
            wanted.current = !next;
            console.warn("Companion handle could not change its size", error);
        }
    };
    const closeLater = (delay: number, timer: typeof closeTimer) => {
        clear(timer);
        timer.current = setTimeout(() => { timer.current = null; void setHandleOpen(false); }, delay);
    };
    const enter = () => {
        clear(closeTimer);
        closeLater(IDLE_CLOSE_MS, idleTimer);
        void setHandleOpen(true);
    };

    const ready = status?.ready === true;
    const dock = docked ? dockAnchor(DOCK_DISTANCE, FEATURES.indexOf(docked)) : null;
    const dockState = docked && status ? status[docked] : null;
    const scale = open ? 1 : REST_RADIUS / OPEN_RADIUS;
    const centreLabel = t("companion.handle");

    return (
        <div className={styles.root} data-open={open}
            onPointerEnter={enter} onPointerMove={enter}
            onPointerLeave={() => { clear(idleTimer); closeLater(CLOSE_DELAY_MS, closeTimer); }}>
            <svg className={styles.canvas} role="group" aria-label="VRCT-VOX">
                <g className={styles.star} style={{ transform: `translate(${centre.x}px, ${centre.y}px) scale(${scale})` }}>
                    <circle className={styles.plate} r={OPEN_RADIUS * 1.22} />
                    <circle className={styles.ring} r={OPEN_RADIUS * 1.18} />
                    <circle className={styles.ring} r={OPEN_RADIUS * 1.06} />
                    {FEATURES.map((feature, index) => {
                        const value = status?.[feature];
                        return (
                            <polygon key={feature} className={styles.point} points={polygon(pointTriangle(OPEN_RADIUS, index))}
                                data-on={value?.on === true} data-pending={value?.pending === true}
                                data-docked={docked === feature} data-angle={pointAngle(index)}
                                aria-label={t(LABEL_KEYS[feature])}
                                onPointerEnter={() => { if (open) setDocked(feature); }} />
                        );
                    })}
                    <polygon className={styles.core} points={polygon(innerHexagon(OPEN_RADIUS))} role="button"
                        aria-label={centreLabel}
                        onClick={() => {
                            void setHandleOpen(false);
                            bridge.togglePanel().catch(error => console.warn("Companion panel could not be opened", error));
                        }}>
                        <title>{centreLabel}</title>
                    </polygon>
                </g>
            </svg>
            {open && docked && dock && (
                <button key={docked} type="button" className={styles.dock} data-side={dock.side}
                    aria-pressed={dockState?.on === true} disabled={!ready || dockState?.pending === true}
                    style={{
                        left: `${centre.x + dock.at.x}px`, top: `${centre.y + dock.at.y}px`,
                        // It slides out from the star, along its point.
                        [FROM_X]: `${-Math.cos((pointAngle(FEATURES.indexOf(docked)) * Math.PI) / 180) * 14}px`,
                        [FROM_Y]: `${-Math.sin((pointAngle(FEATURES.indexOf(docked)) * Math.PI) / 180) * 14}px`,
                    } as CSSProperties}
                    onClick={() => bridge.request(actionFor(docked)).catch(error => console.warn("Companion request failed", error))}>
                    <span className={styles.dockLabel}>{t(LABEL_KEYS[docked])}</span>
                    <span className={styles.dockState}>{t(dockState?.on ? "companion.on" : "companion.off")}</span>
                </button>
            )}
        </div>
    );
};

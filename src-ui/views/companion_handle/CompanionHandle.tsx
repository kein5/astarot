import { useEffect, useRef, useState, type CSSProperties, type WheelEvent } from "react";
import { useI18n } from "@useI18n";
import { companionBridge, type CompanionBridge, type HandleLayout } from "../../logics/companion/bridge.ts";
import { actionFor, FEATURES, type CompanionStatus, type Feature } from "../../logics/companion/status.ts";
import {
    angleOf, baseRotation, dockAt, facesInward, innerHexagon, inwardSide, isEdge, pointTriangle, polygon, TURN,
    type Edge,
} from "../../logics/companion/hexagram.ts";
import * as styles from "./CompanionHandle.css.ts";
import { FROM_X, FROM_Y } from "./CompanionHandle.css.ts";

// The tray companion's hexagram (experimental feature "tray_companion", Issue #355): a magic
// circle around a hexagram, the shape of the ASTAROT symbol. It hides at a screen edge (the
// setting TRAY_COMPANION_EDGE). When the pointer comes near, the app shows this window and half
// of the hexagram comes out over the edge (src-tauri/src/companion.rs). The mouse wheel turns it
// a point at a time; three of its six triangles show at once, one for each of the main switches,
// and the triangles of the switches that are on are filled. Hovering one docks that feature out
// towards the middle of the screen; pressing the docked label runs the main window's own switch.
// Hovering alone changes nothing. The hexagon in the middle opens the control panel. The window
// never takes the focus.

// The hexagram's size (CSS px); the window around it is the app's (OUT_BESIDE, OUT_ALONG).
export const OPEN_RADIUS = 58;
const DOCK_DISTANCE = OPEN_RADIUS + 14;
// A wheel that spins fast turns the hexagram one point at a time.
export const TURN_EVERY_MS = 140;

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
    const [layout, setLayout] = useState<HandleLayout | null>(null);
    const [turns, setTurns] = useState(0);
    const [docked, setDocked] = useState<Feature | null>(null);
    const lastTurn = useRef(0);

    useEffect(() => {
        let disposed = false;
        const refresh = async () => {
            try {
                const next = await bridge.status();
                if (disposed) return;
                if (next.language !== i18n.language) await i18n.changeLanguage(next.language);
                setStatus(next);
            } catch (error) { console.warn("Companion hexagram could not read the state", error); }
        };
        const place = async () => {
            try {
                const next = await bridge.layout();
                if (disposed) return;
                setLayout(next);
                if (!next.out) setDocked(null);
            } catch (error) { console.warn("Companion hexagram could not read its place", error); }
        };
        const changed = bridge.onChanged(() => { void refresh(); });
        const moved = bridge.onLayout(() => { void place(); });
        changed.then(refresh, () => {});
        moved.then(place, () => {});
        return () => {
            disposed = true;
            changed.then(off => off(), () => {});
            moved.then(off => off(), () => {});
        };
    }, [bridge]);

    if (!layout?.out) return null;
    const edge: Edge = isEdge(layout.edge) ? layout.edge : "right";
    const rotation = baseRotation(edge) + TURN * turns;
    const side = inwardSide(edge);
    const ready = status?.ready === true;

    const turn = (event: WheelEvent) => {
        if (event.deltaY === 0) return;
        const now = Date.now();
        if (now - lastTurn.current < TURN_EVERY_MS) return;
        lastTurn.current = now;
        setTurns(value => value + Math.sign(event.deltaY));
        setDocked(null);
    };

    const dockIndex = docked ? FEATURES.indexOf(docked) : -1;
    const dockAngle = angleOf(dockIndex, rotation);
    const dock = docked ? dockAt(DOCK_DISTANCE, dockAngle, side) : null;
    const dockState = docked && status ? status[docked] : null;
    const centreLabel = t("companion.handle");

    return (
        <div className={styles.root} data-edge={edge} onWheel={turn}>
            <svg className={styles.canvas} role="group" aria-label="VRCT-VOX">
                <g style={{ transform: `translate(${layout.x}px, ${layout.y}px)` }}>
                    <g className={styles.arrive}>
                        <circle className={styles.plate} r={OPEN_RADIUS * 1.22} />
                        <circle className={styles.ring} r={OPEN_RADIUS * 1.18} />
                        <circle className={styles.ring} r={OPEN_RADIUS * 1.06} />
                        <g className={styles.star} style={{ transform: `rotate(${rotation}deg)` }}>
                            {FEATURES.map((feature, index) => {
                                const value = status?.[feature];
                                const shown = facesInward(angleOf(index, rotation), edge);
                                return (
                                    <polygon key={feature} className={styles.point} points={polygon(pointTriangle(OPEN_RADIUS, index))}
                                        data-on={value?.on === true} data-pending={value?.pending === true}
                                        data-docked={docked === feature} data-shown={shown}
                                        aria-label={t(LABEL_KEYS[feature])} aria-hidden={!shown}
                                        onPointerEnter={() => { if (shown) setDocked(feature); }} />
                                );
                            })}
                            <polygon className={styles.core} points={polygon(innerHexagon(OPEN_RADIUS))} role="button"
                                aria-label={centreLabel}
                                onClick={() => bridge.togglePanel().catch(error => console.warn("Companion panel could not be opened", error))}>
                                <title>{centreLabel}</title>
                            </polygon>
                        </g>
                    </g>
                </g>
            </svg>
            {docked && dock && (
                <button key={`${docked}-${rotation}`} type="button" className={styles.dock} data-side={dock.side}
                    aria-pressed={dockState?.on === true} disabled={!ready || dockState?.pending === true}
                    style={{
                        left: `${layout.x + dock.at.x}px`, top: `${layout.y + dock.at.y}px`,
                        // It slides out from the hexagram, along its point.
                        [FROM_X]: `${-Math.cos((dockAngle * Math.PI) / 180) * 14}px`,
                        [FROM_Y]: `${-Math.sin((dockAngle * Math.PI) / 180) * 14}px`,
                    } as CSSProperties}
                    onClick={() => bridge.request(actionFor(docked)).catch(error => console.warn("Companion request failed", error))}>
                    <span className={styles.dockLabel}>{t(LABEL_KEYS[docked])}</span>
                    <span className={styles.dockState}>{t(dockState?.on ? "companion.on" : "companion.off")}</span>
                </button>
            )}
        </div>
    );
};

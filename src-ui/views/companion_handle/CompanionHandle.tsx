import { useEffect, useRef, useState, type ComponentType, type CSSProperties, type SVGProps, type WheelEvent } from "react";
import { useI18n } from "@useI18n";
import { companionBridge, type CompanionBridge, type HandleLayout } from "../../logics/companion/bridge.ts";
import { actionFor, edgeAction, FEATURES, type CompanionStatus, type Feature } from "../../logics/companion/status.ts";
import {
    angleOf, baseRotation, centroid, dockAt, EDGES, facesInward, innerHexagon, inwardAngle, inwardSide, isEdge, pointTriangle, polygon, TURN,
    type Edge,
} from "../../logics/companion/hexagram.ts";
import MicSvg from "@images/mic.svg?react";
import TranslationSvg from "@images/translation.svg?react";
import TtsSpeakerSvg from "@images/tts_speaker.svg?react";
import VoiceConversionSvg from "@images/voice_conversion.svg?react";
import HeadphonesSvg from "@images/headphones.svg?react";
import ChatTranscribeSvg from "@images/chat_transcribe.svg?react";
import * as styles from "./CompanionHandle.css.ts";
import { FROM_X, FROM_Y } from "./CompanionHandle.css.ts";

// The tray companion's hexagram (experimental feature "tray_companion", Issue #355): a magic
// circle around a hexagram, the shape of the ASTAROT symbol. It hides at a screen edge (the
// setting TRAY_COMPANION_EDGE). When the pointer comes near, the app shows this window and half
// of the hexagram comes out over the edge (src-tauri/src/companion.rs). The mouse wheel turns it
// a point at a time; three of its six triangles show at once, one for each of the main switches.
// Each triangle carries its feature's icon. A switch that is off has an Off-White triangle and
// icon; one that is on has a Lilac triangle, with a thicker outline, and a Lilac icon (#536).
// Hovering one docks that feature out towards the middle of the screen; pressing the docked label
// runs the main window's own switch.
// Hovering the hexagon in the middle docks out the common settings (the edge to hide at, the main
// window, the control panel). Hovering alone changes nothing. The window never takes the focus.

// The hexagram's size (CSS px); the window around it is the app's (OUT_BESIDE, OUT_ALONG).
export const OPEN_RADIUS = 58;
const DOCK_DISTANCE = OPEN_RADIUS + 14;
// A wheel that spins fast turns the hexagram one point at a time.
export const TURN_EVERY_MS = 140;
// The pointer must rest on a triangle or the middle this long before its dock opens: on the way
// from the middle to the common settings it crosses a triangle, which must not take over.
export const AIM_MS = 180;
// The common settings dock out beyond the plate.
const MENU_DISTANCE = OPEN_RADIUS * 1.22 + 10;

// What is docked out: one of the six switches, or the common settings of the middle.
type Docked = Feature | "common";

// The same icons as the main window's switches, one in each triangle (#536). They stay upright
// while the hexagram turns, and they are Lilac while the feature is on, Off-White while it is off.
export const FEATURE_ICONS: Record<Feature, ComponentType<SVGProps<SVGSVGElement>>> = {
    mic: MicSvg,
    translation: TranslationSvg,
    tts: TtsSpeakerSvg,
    rvc: VoiceConversionSvg,
    listening: HeadphonesSvg,
    ocr: ChatTranscribeSvg,
};
// The icon's size (CSS px): it stays inside its triangle's inscribed circle.
export const ICON_SIZE = 13;

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
    const [docked, setDocked] = useState<Docked | null>(null);
    const lastTurn = useRef(0);
    const aimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const unaim = () => {
        if (aimTimer.current !== null) clearTimeout(aimTimer.current);
        aimTimer.current = null;
    };
    const aim = (target: Docked) => {
        unaim();
        aimTimer.current = setTimeout(() => { aimTimer.current = null; setDocked(target); }, AIM_MS);
    };
    useEffect(() => unaim, []);

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

    const feature = docked && docked !== "common" ? docked : null;
    const dockAngle = feature ? angleOf(FEATURES.indexOf(feature), rotation) : inwardAngle(edge);
    const dock = feature ? dockAt(DOCK_DISTANCE, dockAngle, side) : null;
    const dockState = feature && status ? status[feature] : null;
    const menu = docked === "common" ? dockAt(MENU_DISTANCE, inwardAngle(edge), side) : null;
    const slide = (angle: number) => ({
        // It slides out from the hexagram, along the direction it opens to.
        [FROM_X]: `${-Math.cos((angle * Math.PI) / 180) * 14}px`,
        [FROM_Y]: `${-Math.sin((angle * Math.PI) / 180) * 14}px`,
    });
    const ask = (action: Parameters<CompanionBridge["request"]>[0]) =>
        bridge.request(action).catch(error => console.warn("Companion request failed", error));
    const togglePanel = () => bridge.togglePanel().catch(error => console.warn("Companion panel could not be opened", error));
    const centreLabel = t("companion.handle");

    return (
        <div className={styles.root} data-edge={edge} onWheel={turn}>
            <svg className={styles.canvas} role="group" aria-label="ASTAROT">
                <g style={{ transform: `translate(${layout.x}px, ${layout.y}px)` }}>
                    <g className={styles.arrive}>
                        <circle className={styles.plate} r={OPEN_RADIUS * 1.22} />
                        <circle className={styles.ring} r={OPEN_RADIUS * 1.18} />
                        <circle className={styles.ring} r={OPEN_RADIUS * 1.06} />
                        <g className={styles.star} style={{ transform: `rotate(${rotation}deg)` }}>
                            {FEATURES.map((feature, index) => {
                                const value = status?.[feature];
                                const shown = facesInward(angleOf(index, rotation), edge);
                                const triangle = pointTriangle(OPEN_RADIUS, index);
                                const middle = centroid(triangle);
                                const Icon = FEATURE_ICONS[feature];
                                return (
                                    <g key={feature}>
                                        <polygon className={styles.point} points={polygon(triangle)}
                                            data-on={value?.on === true} data-pending={value?.pending === true} data-blocked={value?.blocked === true}
                                            data-docked={docked === feature} data-shown={shown}
                                            aria-label={t(LABEL_KEYS[feature])} aria-hidden={!shown}
                                            onPointerEnter={() => { if (shown) aim(feature); }} onPointerLeave={unaim} />
                                        {/* What the triangle is, and whether it is on, without docking it out (#536). */}
                                        <g transform={`translate(${middle.x} ${middle.y})`}>
                                            <g className={styles.icon} data-feature={feature} data-on={value?.on === true}
                                                data-pending={value?.pending === true} data-blocked={value?.blocked === true} data-shown={shown}
                                                style={{ transform: `rotate(${-rotation}deg)` }}>
                                                {/* The triangle carries the name; the picture adds nothing to read. */}
                                                <Icon x={-ICON_SIZE / 2} y={-ICON_SIZE / 2} width={ICON_SIZE} height={ICON_SIZE} aria-hidden="true" focusable="false" />
                                            </g>
                                        </g>
                                    </g>
                                );
                            })}
                            <polygon className={styles.core} points={polygon(innerHexagon(OPEN_RADIUS))} role="button"
                                aria-label={centreLabel} aria-haspopup="menu"
                                onPointerEnter={() => aim("common")} onPointerLeave={unaim} onClick={togglePanel}>
                                <title>{centreLabel}</title>
                            </polygon>
                        </g>
                    </g>
                </g>
            </svg>
            {feature && dock && (
                <button key={`${feature}-${rotation}`} type="button" className={styles.dock} data-side={dock.side}
                    aria-pressed={dockState?.on === true} disabled={!ready || dockState?.pending === true}
                    aria-disabled={dockState?.blocked === true || undefined} data-blocked={dockState?.blocked === true}
                    style={{ left: `${layout.x + dock.at.x}px`, top: `${layout.y + dock.at.y}px`, ...slide(dockAngle) } as CSSProperties}
                    onClick={() => ask(actionFor(feature))}>
                    <span className={styles.dockLabel}>{t(LABEL_KEYS[feature])}</span>
                    <span className={styles.dockState}>{t(dockState?.blocked ? "companion.unavailable" : dockState?.on ? "companion.on" : "companion.off")}</span>
                </button>
            )}
            {menu && (
                <div key={`common-${edge}`} className={styles.menu} data-side={menu.side} role="group"
                    aria-label={t("companion.common.title")}
                    style={{ left: `${layout.x + menu.at.x}px`, top: `${layout.y + menu.at.y}px`, ...slide(inwardAngle(edge)) } as CSSProperties}>
                    <p className={styles.menuTitle}>{t("companion.common.title")}</p>
                    <div className={styles.menuRow} role="group" aria-label={t("companion.common.edge")}>
                        <span className={styles.menuLabel}>{t("companion.common.edge")}</span>
                        <span className={styles.edges}>
                            {EDGES.map(value => (
                                <button key={value} type="button" className={styles.edge} aria-pressed={value === edge}
                                    onClick={() => { if (value !== edge) void ask(edgeAction(value)); }}>
                                    {t(`config_page.experimental_features.items.tray_companion.edge.${value}`)}
                                </button>
                            ))}
                        </span>
                    </div>
                    <button type="button" className={styles.menuItem} onClick={() => ask("open_main")}>{t("companion.open_main")}</button>
                    <button type="button" className={styles.menuItem} onClick={togglePanel}>{t("companion.menu_panel")}</button>
                </div>
            )}
        </div>
    );
};

import { useEffect, useRef, useState, type ComponentType, type CSSProperties, type SVGProps, type WheelEvent } from "react";
import { useI18n } from "@useI18n";
import { companionBridge, type CompanionBridge, type HandleLayout } from "../../logics/companion/bridge.ts";
import { actionFor, edgeAction, FEATURES, WHEEL_HINT_SEEN, type CompanionStatus, type Feature } from "../../logics/companion/status.ts";
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
// icon; one that is on has a Lilac triangle and a Lilac icon (#536).
// Hovering one docks that feature out towards the middle of the screen; pressing the triangle, or
// its docked label, runs the main window's own switch (#536). A triangle lights up under the
// pointer; a label says that it is switching until the main window answers, or that the request
// could not be sent; a switch that turns on or off flashes in its triangle. The first time the
// hexagram ever comes out, it says for a moment that the wheel turns it (#536).
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
// How long a switch that turned on or off flashes in its triangle (#536).
export const FLASH_MS = 800;
// A pressed label says that it is switching until the main window answers, at most this long: a
// switch that cannot change (its main switch says why) answers nothing.
export const ASK_MS = 4000;
// How long a label says that its request could not be sent.
export const FAILED_MS = 3000;
// How long the hexagram says, the first time it comes out, that the wheel turns it.
export const HINT_MS = 5000;

// What is docked out: one of the six switches, or the common settings of the middle.
type Docked = Feature | "common";
// A label pressed and waiting, or one whose request failed; the id tells a later press apart.
type Mark = { feature: Feature; id: number };
// A switch that turned on or off, flashing in its triangle.
type Flash = { to: "on" | "off"; id: number };

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
    const [asking, setAsking] = useState<Mark | null>(null);
    const [failed, setFailed] = useState<Mark | null>(null);
    const [flash, setFlash] = useState<Partial<Record<Feature, Flash>>>({});
    const [hint, setHint] = useState(false);
    const told = useRef(false);
    const lastStatus = useRef<CompanionStatus | null>(null);
    const nextId = useRef(0);
    const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
    const later = (ms: number, then: () => void) => {
        const timer = setTimeout(() => { timers.current.delete(timer); then(); }, ms);
        timers.current.add(timer);
    };
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
    useEffect(() => () => {
        unaim();
        for (const timer of timers.current) clearTimeout(timer);
    }, []);

    useEffect(() => {
        let disposed = false;
        // What changed between two states the main window published: a switch that turned on or
        // off flashes, and a pressed label whose switch moved (on, off or waiting) has its answer.
        const answered = (before: CompanionStatus, next: CompanionStatus) => {
            const flipped = FEATURES.filter(feature => before[feature].on !== next[feature].on);
            const moved = FEATURES.filter(feature => flipped.includes(feature) || before[feature].pending !== next[feature].pending);
            if (moved.length > 0) setAsking(current => (current && moved.includes(current.feature) ? null : current));
            if (flipped.length === 0) return;
            const id = ++nextId.current;
            setFlash(current => ({ ...current, ...Object.fromEntries(flipped.map(feature => [feature, { to: next[feature].on ? "on" : "off", id }])) }));
            const timer = setTimeout(() => {
                timers.current.delete(timer);
                setFlash(current => Object.fromEntries(Object.entries(current).filter(([, value]) => value.id !== id)));
            }, FLASH_MS);
            timers.current.add(timer);
        };
        const refresh = async () => {
            try {
                const next = await bridge.status();
                if (disposed) return;
                if (next.language !== i18n.language) await i18n.changeLanguage(next.language);
                setStatus(next);
                const before = lastStatus.current;
                lastStatus.current = next;
                if (before) answered(before, next);
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

    // A press on a switch's label: the main window runs its own switch. Until it answers, the label
    // says that it is switching and cannot be pressed again; a request that could not be sent says so.
    const press = (target: Feature, blocked: boolean) => {
        const id = ++nextId.current;
        setFailed(current => (current?.feature === target ? null : current));
        // A greyed-out switch does not change: the main window says why (#562).
        if (!blocked) {
            setAsking({ feature: target, id });
            later(ASK_MS, () => setAsking(current => (current?.id === id ? null : current)));
        }
        bridge.request(actionFor(target)).catch(error => {
            console.warn("Companion request failed", error);
            setAsking(current => (current?.id === id ? null : current));
            setFailed({ feature: target, id });
            later(FAILED_MS, () => setFailed(current => (current?.id === id ? null : current)));
        });
    };

    // The first time it comes out (the main window keeps whether it has, #536), it says that the
    // wheel turns it, for a moment; the wheel or a docked label ends it sooner. It is said once
    // in a run even before the main window has kept it.
    const out = layout?.out === true;
    const untold = status?.hinted === false;
    useEffect(() => {
        if (!out) { setHint(false); return; }
        if (!untold || told.current) return;
        told.current = true;
        setHint(true);
        bridge.request(WHEEL_HINT_SEEN).catch(error => console.warn("Companion hint could not be kept", error));
        const timer = setTimeout(() => { timers.current.delete(timer); setHint(false); }, HINT_MS);
        timers.current.add(timer);
    }, [out, untold, bridge]);

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
        setHint(false);
    };

    const feature = docked && docked !== "common" ? docked : null;
    const dockAngle = feature ? angleOf(FEATURES.indexOf(feature), rotation) : inwardAngle(edge);
    const dock = feature ? dockAt(DOCK_DISTANCE, dockAngle, side) : null;
    const dockState = feature && status ? status[feature] : null;
    const waiting = (target: Feature) => status?.[target]?.pending === true || asking?.feature === target;
    const dockWord = !feature || !dockState ? "companion.off"
        : failed?.feature === feature ? "companion.failed"
        : dockState.blocked ? "companion.unavailable"
        : waiting(feature) ? "companion.switching"
        : dockState.on ? "companion.on" : "companion.off";
    const menu = docked === "common" ? dockAt(MENU_DISTANCE, inwardAngle(edge), side) : null;
    const hintAt = dockAt(MENU_DISTANCE, inwardAngle(edge), side);
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
                                            data-on={value?.on === true} data-pending={waiting(feature)} data-blocked={value?.blocked === true}
                                            data-docked={docked === feature} data-shown={shown} data-flash={flash[feature]?.to}
                                            aria-label={t(LABEL_KEYS[feature])} aria-hidden={!shown}
                                            onPointerEnter={() => { if (shown) aim(feature); }} onPointerLeave={unaim}
                                            onClick={() => {
                                                // A press switches it, as its label does, and docks the label to say so.
                                                if (!shown) return;
                                                unaim();
                                                setDocked(feature);
                                                if (ready && !waiting(feature)) press(feature, value?.blocked === true);
                                            }} />
                                        {/* What the triangle is, and whether it is on, without docking it out (#536). */}
                                        <g transform={`translate(${middle.x} ${middle.y})`}>
                                            <g className={styles.icon} data-feature={feature} data-on={value?.on === true}
                                                data-pending={waiting(feature)} data-blocked={value?.blocked === true} data-shown={shown}
                                                data-flash={flash[feature]?.to}
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
                            {/* The outline of a switch that is on, drawn over the rest of the star: the hexagon in
                                the middle and the neighbouring triangles draw their own outlines on the same lines,
                                and no edge of a triangle that is on may show their colour (#536). Unnamed, it is
                                not read; the triangle under it carries the name. */}
                            {FEATURES.map((feature, index) => {
                                const value = status?.[feature];
                                return (
                                    <polygon key={feature} className={styles.outline} points={polygon(pointTriangle(OPEN_RADIUS, index))}
                                        data-outline={feature} data-on={value?.on === true} data-pending={waiting(feature)}
                                        data-blocked={value?.blocked === true} data-docked={docked === feature}
                                        data-shown={facesInward(angleOf(index, rotation), edge)} />
                                );
                            })}
                        </g>
                    </g>
                </g>
            </svg>
            {feature && dock && (
                <button key={`${feature}-${rotation}`} type="button" className={styles.dock} data-side={dock.side}
                    aria-pressed={dockState?.on === true} disabled={!ready || waiting(feature)}
                    aria-disabled={dockState?.blocked === true || undefined} data-blocked={dockState?.blocked === true}
                    style={{ left: `${layout.x + dock.at.x}px`, top: `${layout.y + dock.at.y}px`, ...slide(dockAngle) } as CSSProperties}
                    onClick={() => press(feature, dockState?.blocked === true)}>
                    <span className={styles.dockLabel}>{t(LABEL_KEYS[feature])}</span>
                    <span className={styles.dockState} data-failed={failed?.feature === feature}>{t(dockWord)}</span>
                </button>
            )}
            {hint && !docked && (
                <p className={styles.hint} data-side={hintAt.side} role="status"
                    style={{ left: `${layout.x + hintAt.at.x}px`, top: `${layout.y + hintAt.at.y}px`, ...slide(inwardAngle(edge)) } as CSSProperties}>
                    {t("companion.wheel_hint")}
                </p>
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

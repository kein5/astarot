import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, RefObject } from "react";
import { useStdoutToPython } from "@useStdoutToPython";
import type { AsyncStdoutToPython } from "@useStdoutToPython";
import { useVr } from "@logics_configs";
import { tooltipGeometry, tooltipMarker } from "../../logics/common/vrPanelTooltip";
import type { TooltipGeometry } from "../../logics/common/vrPanelTooltip";
import styles from "./VrTooltip.module.scss";

const TARGET = "button[data-tooltip-title]";
const REQUEST = "/run/vr_panel_tooltip";

export interface VrTooltipButtonProps extends ComponentPropsWithoutRef<"button"> {
    tipTitle?: string;
    tipState?: string;
    tipHelp?: string;
    tipForce?: boolean;
}

// tipForce: show this button's tooltip even when the tooltips are turned off (what it says
// cannot be read anywhere else in VR).
export const VrTooltipButton = ({ tipTitle, tipState, tipHelp, tipForce = false, children, ...props }: VrTooltipButtonProps) => {
    const id = useId();
    return <button {...props} type="button" data-tooltip-title={tipTitle}
        data-tooltip-state={tipState} data-tooltip-help={tipHelp} data-tooltip-force={tipForce ? "true" : undefined}
        aria-describedby={id}>
        {children}<span id={id} className={styles.sr_only}>{[tipState, tipHelp].filter(Boolean).join(". ")}</span>
    </button>;
};

// The layout's parts the tooltip reads: its epoch and the regions' [x, y, width, height].
export interface VrTooltipLayout {
    tooltip_epoch?: number;
    regions: Readonly<Record<string, readonly number[]>>;
}

type TipRegion = "launcher" | "toolbar";
type TipMode = "hover" | "focus";

interface Tip extends TooltipGeometry {
    epoch: number;
    revision: number;
    visible: true;
    region: TipRegion;
    mode: TipMode;
    title?: string;
    state?: string;
    help?: string;
}

// The focused element when it is inside the atlas and shows its focus ring.
const visibleFocus = (atlas: HTMLElement): Element | null => {
    const focused = document.activeElement;
    return focused !== null && atlas.contains(focused) && focused.matches(":focus-visible") ? focused : null;
};

// The body lives in an atlas region. Python displays that region in one shared,
// non-interactive overlay above the target, after verifying the captured marker.
export const VrTooltip = ({ atlasRef, layout }: { atlasRef: RefObject<HTMLElement | null>; layout: VrTooltipLayout }) => {
    const [tip, setTip] = useState<Tip | null>(null);
    const body = useRef<HTMLDivElement>(null);
    const sequence = useRef({ epoch: 0, revision: 0 });
    const send = useRef<AsyncStdoutToPython | null>(null);
    send.current = useStdoutToPython().asyncStdoutToPython;
    const epoch = layout.tooltip_epoch ?? 0;
    const regionKey = JSON.stringify([layout.regions.launcher, layout.regions.toolbar]);
    // 設定でOFFのときは、data-tooltip-force の付いたボタンのものだけを出す (出ている途中でOFFにすると、下の cleanup が消す)
    const enabled = useVr().currentOverlayVrTooltip.data !== false;

    useEffect(() => {
        const atlas = atlasRef.current;
        if (!atlas || !epoch) { setTip(null); return; }
        const shown = (element: HTMLElement | null | undefined) => element && (enabled || element.dataset.tooltipForce === "true") ? element : null;
        if (sequence.current.epoch !== epoch) sequence.current = { epoch, revision: 0 };
        let target: HTMLElement | null = null;
        let mode: TipMode = "hover";
        let dismissed: HTMLElement | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let snapshot = "";
        let disposed = false;
        let preferFocus = visibleFocus(atlas) !== null;
        const next = () => ++sequence.current.revision;
        const transmit = (payload: unknown) => Promise.resolve(send.current?.(REQUEST, payload)).catch(console.error);
        const hide = () => {
            if (timer !== null) clearTimeout(timer);
            timer = null;
            setTip(null);
            transmit({ epoch, revision: next(), visible: false });
        };
        const show = () => {
            timer = null;
            if (!target?.isConnected || dismissed === target) return;
            const regionElement = target.closest<HTMLElement>("[data-vr-region]");
            const region = regionElement?.dataset.vrRegion;
            if (!regionElement || (region !== "launcher" && region !== "toolbar")) return;
            const [, , width, height] = layout.regions[region];
            const geometry = tooltipGeometry(regionElement.getBoundingClientRect(), target.getBoundingClientRect(), width, height);
            if (!geometry) return;
            setTip({ epoch, revision: next(), visible: true, region, mode, ...geometry,
                title: target.dataset.tooltipTitle, state: target.dataset.tooltipState, help: target.dataset.tooltipHelp });
        };
        const update = (records: readonly MutationRecord[] = []) => {
            if (disposed) return;
            if (records.some(record => record.attributeName === "data-vr-hover")) preferFocus = false;
            const active = shown(visibleFocus(atlas)?.closest<HTMLElement>(TARGET));
            const hovered = shown(atlas.querySelector<HTMLElement>(`${TARGET}[data-vr-hover]`));
            const candidate = preferFocus ? active : hovered;
            const nextMode: TipMode = preferFocus ? "focus" : "hover";
            const content = candidate ? [candidate.dataset.tooltipTitle, candidate.dataset.tooltipState,
                candidate.dataset.tooltipHelp].join("\u0000") : "";
            if (candidate === target && nextMode === mode && content === snapshot) return;
            const isNewTarget = candidate !== target || nextMode !== mode;
            hide();
            if (candidate !== target) dismissed = null;
            target = candidate;
            mode = nextMode;
            snapshot = content;
            if (target && dismissed !== target) {
                timer = setTimeout(show, mode === "focus" || !isNewTarget ? 0 : 300);
            }
        };
        const focus = () => {
            if (document.activeElement?.matches(":focus-visible")) preferFocus = true;
            else if (atlas.contains(document.activeElement)) preferFocus = false;
            update();
        };
        const blur = () => queueMicrotask(focus);
        const keydown = (event: KeyboardEvent) => {
            if (event.key === "Escape") { dismissed = target; hide(); }
            else if (event.key === "Tab") preferFocus = true;
        };
        const observer = new MutationObserver(records => update(records));
        observer.observe(atlas, { subtree: true, attributes: true, childList: true,
            attributeFilter: ["data-vr-hover", "data-tooltip-title", "data-tooltip-state", "data-tooltip-help", "data-tooltip-force"] });
        atlas.addEventListener("focusin", focus);
        atlas.addEventListener("focusout", blur);
        document.addEventListener("keydown", keydown);
        update();
        return () => {
            disposed = true;
            observer.disconnect();
            atlas.removeEventListener("focusin", focus);
            atlas.removeEventListener("focusout", blur);
            document.removeEventListener("keydown", keydown);
            hide();
        };
    }, [atlasRef, epoch, regionKey, enabled]);

    useLayoutEffect(() => {
        if (!tip || !body.current) return;
        // offsetHeight remains in atlas pixels even if an HTML preview is scaled.
        const height = body.current.offsetHeight;
        if (height < 1 || height > 104) return;
        let second: number | null = null;
        const first = requestAnimationFrame(() => {
            second = requestAnimationFrame(() => {
                if (sequence.current.epoch !== tip.epoch || sequence.current.revision !== tip.revision) return;
                const { epoch: requestEpoch, revision, region, mode: requestMode, button, arrow_x } = tip;
                Promise.resolve(send.current?.(REQUEST, { epoch: requestEpoch, revision, visible: true, region,
                    mode: requestMode, button, arrow_x, size: [360, height] })).catch(console.error);
            });
        });
        return () => {
            cancelAnimationFrame(first);
            if (second !== null) cancelAnimationFrame(second);
        };
    }, [tip]);

    if (!tip) return null;
    return <>
        <div className={styles.marker} data-tooltip-marker aria-hidden="true">
            {tooltipMarker(tip.epoch, tip.revision).map((bit, i) => <span key={i} style={{ background: bit ? "#fff" : "#000" }} />)}
        </div>
        <div ref={body} role="tooltip" className={styles.body} style={{ "--tip-arrow": `${tip.arrow_x}px` }}>
            <div className={styles.title}><strong>{tip.title}</strong><span>{tip.state}</span></div>
            {tip.help && <p>{tip.help}</p>}
        </div>
    </>;
};

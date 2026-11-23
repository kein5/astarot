import { useEffect, useLayoutEffect, useState } from "react";
import clsx from "clsx";
import { captionOverlayBridge } from "../../logics/captionOverlay/bridge";
import type { CaptionOverlayBridge } from "../../logics/captionOverlay/bridge";
import { isCaptionSnapshot, nextChange, visibleLines } from "../../logics/captionOverlay/lines";
import type { CaptionFlowItem, CaptionSnapshot } from "../../logics/captionOverlay/lines";
import { speakerLabels } from "../../logics/common/speakerLabels";
import * as styles from "./CaptionOverlay.css.ts";

// The classes looked up by a name made at run time: a name with no class of its own gives none.
const classNamed: Partial<Record<string, string>> = styles;

// The colours a voice can take (CaptionOverlay.css.ts); the fifth voice starts over.
const VOICE_COLOURS = 4;
// "A" is 0, "B" is 1, ... "Z" is 25, "AA" is 26: the order the server first heard the voices in.
const voiceIndex = (label: string) => [...label].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;

export interface CaptionOverlayProps {
    bridge?: CaptionOverlayBridge;
    now?: () => number;
}

// Captions over the desktop. The window lets clicks through and never has the
// focus, so nothing here can be operated: it only draws what the main window
// handed over, and drops each line when its time has passed.
export const CaptionOverlay = ({ bridge = captionOverlayBridge, now = Date.now }: CaptionOverlayProps) => {
    const [snapshot, setSnapshot] = useState<CaptionSnapshot | null>(null);
    const [, setTick] = useState(0);

    useEffect(() => {
        let disposed = false, revision = 0;
        const refresh = async () => {
            const current = ++revision;
            try {
                const next = await bridge.snapshot();
                if (disposed || current !== revision) return;
                // Captions of another shape are not drawn; the words are not logged.
                if (isCaptionSnapshot(next)) setSnapshot(next);
                else console.warn("Caption overlay got captions it cannot read");
            } catch (error) { console.warn("Caption overlay could not read its captions", error); }
        };
        const off = bridge.onChanged(refresh);
        off.then(refresh, () => {});
        return () => { disposed = true; off.then(stop => stop(), () => {}); };
    }, [bridge]);

    useLayoutEffect(() => {
        if (!snapshot) return;
        const root = document.documentElement.style;
        root.setProperty("--caption_font_size", `${snapshot.font_size}px`);
        root.setProperty("--caption_plate", String(snapshot.opacity));
        root.setProperty("--caption_font_family", JSON.stringify(snapshot.font_family));
    }, [snapshot?.font_size, snapshot?.opacity, snapshot?.font_family]);

    // Draw again when the next line starts to fade or goes.
    useEffect(() => {
        if (!snapshot) return undefined;
        const at = nextChange(snapshot.lines, now());
        if (at === null) return undefined;
        const timer = setTimeout(() => setTick(tick => tick + 1), Math.max(20, at - now()));
        return () => clearTimeout(timer);
    });

    const lines = snapshot ? visibleLines(snapshot.lines, now()) : [];
    const flowItems = snapshot?.flow ?? [];
    const captions = (
        <div className={clsx(styles.container, { [styles.is_top]: snapshot?.position === "top" })}>
            {lines.map(line => {
                // Who spoke, where the game audio's voices were told apart: "A", or "A·B" for two in one
                // line, with the names the user gave them (#447). The colour stays the label's.
                const speakers = line.kind === "received" ? speakerLabels(line.speakers) : [];
                const names: readonly unknown[] = Array.isArray(line.speaker_names) && line.speaker_names.length === speakers.length ? line.speaker_names : [];
                const shown = speakers.map((label, index) => {
                    const name = names[index];
                    return (typeof name === "string" && name) || label;
                });
                const who = speakers.length ? <span key="who" className={styles.who}>{shown.join("·")}</span> : null;
                // The label leads the first paragraph of the line, the original or else the translation.
                const lead = (text: string, first: boolean) => first && who ? [who, text] : text;
                return (
                    <div key={line.id} className={clsx(styles.line, classNamed[line.kind],
                        speakers.length > 0 && classNamed[`voice_${voiceIndex(speakers[0]) % VOICE_COLOURS}`], {
                            [styles.is_fading]: line.fading, [styles.is_pending]: line.pending,
                        })}>
                        {line.text && <p className={styles.text}>{lead(line.text, true)}</p>}
                        {line.translations.map((text, index) => (
                            <p key={index} className={styles.translation}>{lead(text, !line.text && index === 0)}</p>
                        ))}
                    </div>
                );
            })}
        </div>
    );
    const content = !snapshot || flowItems.length === 0 ? captions : (
        <div className={clsx(styles.with_flow, { [styles.is_top]: snapshot.position === "top" })}>
            <FlowStrip items={flowItems} note={snapshot.flow_note} />
            {captions}
        </div>
    );
    if (!snapshot?.adjusting) return content;
    // Ctrl is held over the window: outline the area that can be dragged and show the text
    // size that Ctrl and + or - change. Numbers only, so the page needs no words of its own.
    return <>
        {content}
        <div className={styles.adjust} aria-hidden="true">
            <span className={styles.adjust_size}>{snapshot.font_size} px</span>
        </div>
    </>;
};

interface FlowStripProps {
    items: readonly CaptionFlowItem[];
    note?: string;
}

// Where the user's latest inputs went and how long each step took, in ms, drawn as a path:
// the input, its steps, then the outputs it reached (dashed when it did not). Every word comes
// from the main window; this only draws them. It sits beside the captions, never over them.
const FlowStrip = ({ items, note }: FlowStripProps) => (
    <div className={styles.flow}>
        {items.map(item => {
            const stages = item.rows.filter(row => row.kind === "stage");
            const conversion = item.rows.find(row => row.kind === "conversion");
            const outputs = item.rows.filter(row => row.kind === "chatbox" || row.kind === "speech");
            return <div key={item.id} className={clsx(styles.flow_item, classNamed[`flow_${item.input}`])}>
                <p className={styles.flow_text}>{item.text}</p>
                <div className={styles.flow_path}>
                    <span className={clsx(styles.flow_chip, styles.flow_input)}>{item.label}</span>
                    {stages.map((row, index) => <span key={index} className={styles.flow_step}>
                        <span className={styles.flow_arrow} aria-hidden="true" />
                        <span className={styles.flow_chip}>{row.label}<b>{row.value}</b></span>
                    </span>)}
                    {outputs.length > 0 && <span className={styles.flow_arrow} aria-hidden="true" />}
                    {outputs.length > 0 && <span className={styles.flow_outputs}>
                        {outputs.map((row, index) => <span key={index} className={styles.flow_step}>
                            <span className={clsx(styles.flow_chip, classNamed[`flow_out_${row.kind}`], { [styles.flow_off]: row.off })}>
                                {row.label}<b>{row.value}</b></span>
                            {row.kind === "speech" && !row.off && conversion && <>
                                <span className={styles.flow_arrow} aria-hidden="true" />
                                <span className={clsx(styles.flow_chip, styles.flow_out_conversion)}>{conversion.label}<b>{conversion.value}</b></span>
                            </>}
                        </span>)}
                    </span>}
                </div>
            </div>;
        })}
        {note && <p className={styles.flow_note}>{note}</p>}
    </div>
);

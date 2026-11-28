import { useMemo } from "react";
import clsx from "clsx";
import { useI18n } from "@useI18n";
import { createLanguageNames } from "../../../logics/common/languageNames.ts";
import { formatMs, INPUTS, latestTraces, median, timelineScale, traceTotal } from "../../../logics/flow/ioFlow.ts";
import { flowNote, offGroups, timelineRows } from "../../../logics/flow/flowText.ts";
import { buildFlowGraph } from "../../../logics/flow/flowGraph.ts";
import { gpuRows } from "../../../logics/flow/gpuMemory.ts";
import type { CaptionDevices, FlowInput, FlowLane, IoFlow, Trace } from "../../../logics/flow/ioFlow.ts";
import type { TimelineRow } from "../../../logics/flow/flowText.ts";
import type { GpuMemory } from "../../../logics/flow/gpuMemory.ts";
import { FlowGraph } from "./FlowGraph";
import { Hint } from "../config_page/setting_section/setting_box/_components/hint/Hint";
import * as styles from "./IoFlowView.css.ts";

// The classes looked up by a name made at run time: a name with no class of its own gives none.
const classNamed: Partial<Record<string, string>> = styles;

const HISTORY = 20;

// Where the user's voice and typed chat go with the current settings, drawn as a graph,
// and how long the latest of each took. Shared by the main window's panel and the VR
// window; it only reads, and changes nothing. Every duration is in ms.
// Compact (VR, which cannot scroll): one timeline, for the newest input of either lane.
// The GPU memory is the main window's only (`gpuMemory` from /get/data/gpu_memory).
type IoFlowViewProps = {
    flow: IoFlow | null;
    traces: Trace[];
    // Left out in VR, which shows no GPU memory; null until the first answer.
    gpuMemory?: GpuMemory | null;
    // The devices the running captions record (#1314, M-6); the main window's only.
    devices?: CaptionDevices;
    compact?: boolean;
};

export const IoFlowView = ({ flow, traces, gpuMemory, devices, compact = false }: IoFlowViewProps) => {
    const { t, i18n } = useI18n();
    const names = useMemo(() => createLanguageNames(i18n.language), [i18n.language]);
    const graph = useMemo(() => buildFlowGraph(flow, traces), [flow, traces]);
    // The graph is there exactly when both lanes are (buildFlowGraph).
    if (!graph || !flow?.voice || !flow.chat) return <p className={styles.waiting} role="status">{t("io_flow.loading")}</p>;
    const lanes: Record<FlowInput, FlowLane> = { voice: flow.voice, chat: flow.chat };
    const note = flowNote(flow, t);
    const unused = INPUTS.flatMap(lane => offGroups(lanes[lane].outputs, t)
        .map(group => ({ lane, ...group })));
    const used = devices ? ([["mic", "main_page.transcription_send"], ["speaker", "main_page.transcription_receive"]] as const)
        .flatMap(([source, name]) => devices[source] ? [{ source, name: t(name), device: devices[source] }] : []) : [];
    return <div className={clsx(styles.view, { [styles.compact]: compact })}>
        {/* Which microphone and which output the captions record, while they run. */}
        {used.length > 0 && !compact && <ul className={styles.devices} aria-label={t("io_flow.devices")}>
            {used.map(row => <li key={row.source}>{t("io_flow.device", { name: row.name, device: row.device })}</li>)}
        </ul>}
        <div className={styles.graph_scroll}><FlowGraph graph={graph} names={names} compact={compact} /></div>
        {unused.length > 0 && !compact && <ul className={styles.unused}>
            {unused.map(group => <li key={`${group.lane}:${group.reason}`}>
                <span className={clsx(styles.lane_mark, styles[`mark_${group.lane}`])}>{t(`io_flow.lane_short.${group.lane}`)}</span>
                {t("io_flow.unused", { outputs: group.outputs, reason: group.text })}</li>)}
        </ul>}
        {compact
            ? <Latest trace={latestTraces(traces, 1)[0] ?? null} history={[]} compact />
            : <div className={styles.latest_pair}>
                {INPUTS.map(lane => <Latest key={lane} lane={lane}
                    trace={latestTraces(traces, 1, lane)[0] ?? null} history={latestTraces(traces, HISTORY, lane)} />)}
            </div>}
        {note && <p className={styles.live}>{note}</p>}
        {!compact && gpuMemory !== undefined && <GpuMemorySection memory={gpuMemory} />}
    </div>;
};

// How much GPU memory the app holds on each GPU, by what holds it, and the GPU's whole use.
// How it is read is the hint of the heading (#614), not a line under the readout.
const GpuMemorySection = ({ memory }: { memory: GpuMemory | null }) => {
    const { t } = useI18n();
    const rows = gpuRows(memory, t);
    const state = memory?.state ?? "measuring";
    const message = state !== "ready" ? t(`io_flow.gpu.state.${state}`) : rows.length === 0 ? t("io_flow.gpu.none") : null;
    return <section className={styles.gpu} aria-labelledby="io_flow_gpu_title">
        <div className={styles.gpu_title} data-hint-host>
            <h3 id="io_flow_gpu_title" className={styles.latest_title}>{t("io_flow.gpu.title")}</h3>
            <Hint text={t("io_flow.gpu.note")} focusable />
        </div>
        {message
            ? <p className={styles.no_trace} role="status">{message}</p>
            : <ul className={styles.gpu_list}>
                {rows.map((row, index) => <li key={`${index}:${row.name}`} className={styles.gpu_row}>
                    <p className={styles.gpu_head}>
                        <span className={styles.gpu_name}>{row.name}</span>
                        {row.whole && <span className={styles.gpu_whole}>{row.whole}</span>}
                    </p>
                    {row.segments.length > 0 && <span className={styles.gpu_track} aria-hidden="true">
                        {row.segments.map(segment => <span key={segment.part}
                            className={clsx(styles.gpu_segment, styles[`gpu_${segment.part}`])}
                            style={{ width: `${segment.share * 100}%` }} />)}
                    </span>}
                    <p className={styles.gpu_app}>
                        {t(row.memory === "shared" ? "io_flow.gpu.app_shared" : "io_flow.gpu.app", { size: row.app })}
                    </p>
                    {row.parts.length > 0 && <ul className={styles.gpu_parts}>
                        {row.parts.map(part => <li key={part.part}>
                            <span className={clsx(styles.gpu_swatch, styles[`gpu_${part.part}`])} aria-hidden="true" />{part.text}
                        </li>)}
                    </ul>}
                </li>)}
            </ul>}
    </section>;
};

type LatestProps = {
    trace: Trace | null;
    history: Trace[];
    lane?: FlowInput | null;
    compact?: boolean;
};

const Latest = ({ trace, history, lane = null, compact = false }: LatestProps) => {
    const { t } = useI18n();
    const title = lane ? t(`io_flow.${lane}`) : trace ? t(`io_flow.${trace.input}`) : t("io_flow.newest");
    if (!trace) return <section className={styles.latest}><h3 className={styles.latest_title}>{title}</h3>
        <p className={styles.no_trace}>{t("io_flow.no_trace")}</p></section>;
    const total = traceTotal(trace);
    const scale = timelineScale(total ?? 0);
    const totals = history.map(traceTotal).filter((value): value is number => Number.isInteger(value));
    return <section className={clsx(styles.latest, styles[`latest_${trace.input}`])} aria-label={title}>
        <h3 className={styles.latest_title}>{title}</h3>
        <p className={styles.latest_head}>
            <span className={styles.latest_text}>{t("io_flow.latest_text", { text: trace.text })}</span>
            <span className={styles.latest_total}>{t("io_flow.total")} {formatMs(total)}</span>
        </p>
        {!compact && <p className={styles.origin}>{t(`io_flow.origin.${trace.origin}`)}</p>}
        <Timeline rows={timelineRows(trace, t)} scale={scale} />
        {!compact && totals.length > 1 && <History totals={totals.slice().reverse()} middle={median(totals)} />}
    </section>;
};

// One row per stage or output. Bars share the axis, rounded up to a readable step.
export const Timeline = ({ rows, scale, className }: { rows: TimelineRow[]; scale: number; className?: string }) => {
    const { t } = useI18n();
    return <div className={clsx(styles.timeline, className)} role="list" aria-label={t("io_flow.timeline", { scale })}>
        {rows.map((row, index) => <div key={index} role="listitem" className={clsx(styles.row, { [styles.is_off]: row.off })}>
            <span className={styles.row_label}>{row.label}</span>
            <span className={clsx(styles.track, { [styles.no_track]: row.off })} aria-hidden="true">
                {!row.off && <span className={clsx(styles.bar, classNamed[`bar_${row.kind}`])}
                    style={{ left: `${(row.start / scale) * 100}%`, width: `${Math.max(.5, ((row.end - row.start) / scale) * 100)}%` }} />}
            </span>
            <span className={styles.row_value}>{row.value}</span>
        </div>)}
        <div className={clsx(styles.row, styles.axis_row)} aria-hidden="true">
            <span /><span className={styles.axis}><span>0 ms</span><span>{scale} ms</span></span><span />
        </div>
    </div>;
};

// The totals of recent messages, oldest on the left, with their median.
const History = ({ totals, middle }: { totals: number[]; middle: number | null }) => {
    const { t } = useI18n();
    const top = Math.max(...totals, 1);
    return <div className={styles.history}>
        <span className={styles.bars} aria-hidden="true">
            {totals.map((value, index) => <span key={index} className={clsx(styles.spark, { [styles.is_last]: index === totals.length - 1 })}
                style={{ height: `${Math.max(8, (value / top) * 100)}%` }} />)}
        </span>
        <span className={styles.history_text}>{t("io_flow.median", { count: totals.length, value: formatMs(middle) })}</span>
    </div>;
};

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as styles from "./ExperimentalFeatures.css.ts";
import { useI18n } from "@useI18n";
import { useExperimentalFeatures, useVr } from "@logics_configs";
import { useStdoutToPython } from "@useStdoutToPython";
import RedoSvg from "@images/redo.svg?react";
import CheckMarkSvg from "@images/check_mark.svg?react";
import {
    EXPERIMENTAL_FEATURES,
    isExperimentalFeatureEnabled,
    experimentalFeatureLabelKey,
    experimentalFeatureDescKey,
    experimentalFeatureLeadKey,
    experimentalFeatureRequest,
} from "../../../../../../logics/configs/experimentalFeatures.ts";
import type { ExperimentalFeature, ExperimentalFeatureValues } from "../../../../../../logics/configs/experimentalFeatures.ts";
import { ActionButtonContainer, SwitchContainer, DropdownMenuContainer } from "../_templates/Templates";
import { SectionLabelComponent } from "../_components";
import { HintDescriptions } from "../_components/hint/Hint";
import { PagePointer } from "../_components/page_pointer/PagePointer";
import { EDGES } from "../../../../../../logics/companion/hexagram.ts";

type Current = { state?: string; data?: unknown };

type ListProps = {
    features: readonly ExperimentalFeature[];
    current: Current;
    setValues: (values: ExperimentalFeatureValues) => unknown;
    // The tray companion's own settings: the screen edge its hexagram hides at, and the monitor.
    edge?: { current: Current; set: (edge: string) => unknown };
    monitor?: { current: Current; set: (monitor: string) => unknown; list: () => Promise<MonitorInfo[]> };
    // The VR panel (VR UI), listed here with the features on trial (#554, Q-05).
    vrPanel?: VrPanelProps;
    // The update channel (#466): Stable, the default, or Beta.
    channel?: { current: Current; set: (channel: string) => unknown };
};

// The VR panel keeps its own saved switch (OVERLAY_VR_PANEL, /set/enable/overlay_vr_panel),
// so whoever had it on keeps it on after it moved here from the VR page.
type VrPanelProps = { current: Current; toggle: () => unknown; resetLauncher: () => unknown };

// A connected monitor, as src-tauri/src/companion.rs (companion_monitors) lists it.
export type MonitorInfo = { id: string; number: number; width: number; height: number; primary: boolean };

// While the page is open the list is read again now and then, so a monitor plugged in or out shows.
export const MONITORS_EVERY_MS = 3000;
const PRIMARY_OPTION = "@primary";

// Features that came from the experimental branch after their hands-on checks. Every one is
// off until the user turns it on here (Issue #361).
export const ExperimentalFeatures = () => {
    const { currentIsEnabledOverlayVrPanel, toggleIsEnabledOverlayVrPanel } = useVr();
    const { asyncStdoutToPython } = useStdoutToPython();
    const { currentExperimentalFeatures, setExperimentalFeatures, currentTrayCompanionEdge, setTrayCompanionEdge,
        currentTrayCompanionMonitor, setTrayCompanionMonitor, currentReleaseChannel, setReleaseChannel } = useExperimentalFeatures();
    return (
        <ExperimentalFeatureList
            features={EXPERIMENTAL_FEATURES}
            current={currentExperimentalFeatures}
            setValues={setExperimentalFeatures}
            edge={{ current: currentTrayCompanionEdge, set: setTrayCompanionEdge }}
            monitor={{ current: currentTrayCompanionMonitor, set: setTrayCompanionMonitor,
                list: () => invoke<MonitorInfo[]>("companion_monitors") }}
            vrPanel={{ current: currentIsEnabledOverlayVrPanel, toggle: toggleIsEnabledOverlayVrPanel,
                resetLauncher: () => asyncStdoutToPython("/run/vr_launcher_reset") }}
            channel={{ current: currentReleaseChannel, set: setReleaseChannel }}
        />
    );
};

// The rows' general descriptions and the trial notice are hints here (#614, #1013). The sentence
// that says the app will start differently stays on screen.
export const ExperimentalFeatureList = ({ features, current, setValues, edge, monitor, vrPanel, channel }: ListProps) => {
    const { t } = useI18n();
    return (
        <HintDescriptions>
        <div className={styles.container}>
            {/* Like every other page, it starts with its category heading; the trial notice is
                the heading's hint (#614, #1013). */}
            <SectionLabelComponent label={t("config_page.experimental_features.section_label")}
                desc={t("config_page.experimental_features.notice")} />
            {features.length === 0 && !vrPanel && !channel
                ? <p className={styles.empty}>{t("config_page.experimental_features.empty")}</p>
                : features.map(({ id }) => {
                    const enabled = isExperimentalFeatureEnabled(current.data, id);
                    const lead = experimentalFeatureLeadKey(id);
                    return (
                        <div key={id}>
                            <SwitchContainer
                                setting_id={`experimental_features.${id}`}
                                label={t(experimentalFeatureLabelKey(id))}
                                // The tray companion changes how the app starts, which is read before it is
                                // turned on: that sentence stays on screen, and how it is used is the hint.
                                lead={lead ? t(lead) : undefined}
                                desc={t(experimentalFeatureDescKey(id))}
                                variable={{ state: current.state, data: enabled }}
                                toggleFunction={() => setValues(experimentalFeatureRequest(id, !enabled))}
                            />
                            {id === "tray_companion" && enabled && edge && <TrayCompanionEdge {...edge} />}
                            {id === "tray_companion" && enabled && monitor && <TrayCompanionMonitor {...monitor} />}
                            {/* The page it adds is in another group of the menu: a row leads there
                                (DESIGN.md "Roles in settings", #1266 K-4). */}
                            {id === "talk_ai" && enabled && <PagePointer label={t("config_page.experimental_features.items.talk_ai.page.label")}
                                description={t("config_page.experimental_features.items.talk_ai.page.desc")} tab="talk_ai" />}
                        </div>
                    );
                })}
            {vrPanel && <VrPanelItem {...vrPanel} />}
            {channel && <ReleaseChannelItem {...channel} />}
        </div>
        </HintDescriptions>
    );
};

// Which releases the in-app update offers (#466): Stable (the default) only the stable ones, Beta
// the betas too. A channel set here stays; the app never goes back to an older version, so from
// Beta back to Stable it waits for the next stable release.
export const RELEASE_CHANNELS = ["stable", "beta"] as const;
const ReleaseChannelItem = ({ current, set }: NonNullable<ListProps["channel"]>) => {
    const { t } = useI18n();
    const key = "config_page.experimental_features.items.release_channel";
    const list = Object.fromEntries(RELEASE_CHANNELS.map(channel => [channel, t(`${key}.${channel}`)]));
    return (
        <DropdownMenuContainer
            setting_id="experimental_features.release_channel"
            dropdown_id="release_channel"
            label={t(`${key}.label`)}
            desc={t(`${key}.desc`)}
            selected_id={current.data === "beta" ? "beta" : "stable"}
            list={list}
            selectFunction={(selected: { selected_id: string }) => set(selected.selected_id)}
            state={current.state}
        />
    );
};

// The wrist launcher and windows inside VR, from upstream VRCT and still on trial in VR.
// The launcher's reset is shown with it while it is on, like the tray companion's settings.
const VrPanelItem = ({ current, toggle, resetLauncher }: VrPanelProps) => {
    const { t } = useI18n();
    const key = "config_page.experimental_features.items.vr_panel";
    return (
        <div>
            <SwitchContainer
                setting_id="experimental_features.vr_panel"
                label={t(`${key}.label`)}
                desc={t(`${key}.desc`)}
                variable={current}
                toggleFunction={toggle}
            />
            {current.data === true && <ActionButtonContainer
                setting_id="experimental_features.vr_panel.reset_launcher"
                label={t(`${key}.reset_launcher.label`)}
                desc={t(`${key}.reset_launcher.desc`)}
                IconComponent={RedoSvg}
                ClickedIconComponent={CheckMarkSvg}
                clicked_duration={1000}
                onclickFunction={resetLauncher}
            />}
        </div>
    );
};

// Where the tray companion's hexagram hides: shown under its switch while it is on.
const TrayCompanionEdge = ({ current, set }: NonNullable<ListProps["edge"]>) => {
    const { t } = useI18n();
    const key = "config_page.experimental_features.items.tray_companion.edge";
    const list = Object.fromEntries(EDGES.map(edge => [edge, t(`${key}.${edge}`)]));
    return (
        <DropdownMenuContainer
            setting_id="experimental_features.tray_companion.edge"
            dropdown_id="tray_companion_edge"
            label={t(`${key}.label`)}
            desc={t(`${key}.desc`)}
            selected_id={typeof current.data === "string" ? current.data : "right"}
            list={list}
            selectFunction={(selected: { selected_id: string }) => set(selected.selected_id)}
            state={current.state}
        />
    );
};

// Which monitor the hexagram shows on: the primary one (the default), or one connected now. A
// chosen monitor that is unplugged stays chosen and is listed as not connected; the hexagram uses
// the primary monitor meanwhile and goes back to it when it is plugged in again.
const TrayCompanionMonitor = ({ current, set, list }: NonNullable<ListProps["monitor"]>) => {
    const { t } = useI18n();
    // null until the first list arrives: the saved monitor is not called unplugged before then.
    const [monitors, setMonitors] = useState<MonitorInfo[] | null>(null);
    // The last read failed. Without a list the saved monitor said "Loading" for as long as the
    // reads kept failing (#563); it now says that the list cannot be read.
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let live = true;
        const read = () => list().then(next => {
            if (!live) return;
            setMonitors(next);
            setFailed(false);
        }, () => { if (live) setFailed(true); });
        read();
        const timer = setInterval(read, MONITORS_EVERY_MS);
        return () => { live = false; clearInterval(timer); };
    }, []);
    const key = "config_page.experimental_features.items.tray_companion.monitor";
    const selected = typeof current.data === "string" ? current.data : "";
    // The primary monitor is saved as an empty name; the list gives it an id of its own.
    const options: Record<string, string> = { [PRIMARY_OPTION]: t(`${key}.primary`) };
    for (const item of monitors ?? []) {
        const name = t(`${key}.display`, { number: item.number, width: item.width, height: item.height });
        options[item.id] = item.primary ? `${name} ${t(`${key}.is_primary`)}` : name;
    }
    if (selected && !(selected in options)) {
        options[selected] = t(monitors ? `${key}.missing` : failed ? `${key}.unknown` : "common.loading");
    }
    return (
        <DropdownMenuContainer
            setting_id="experimental_features.tray_companion.monitor"
            dropdown_id="tray_companion_monitor"
            label={t(`${key}.label`)}
            desc={t(`${key}.desc`)}
            selected_id={selected || PRIMARY_OPTION}
            list={options}
            selectFunction={(choice: { selected_id: string }) => set(choice.selected_id === PRIMARY_OPTION ? "" : choice.selected_id)}
            state={current.state}
        />
    );
};

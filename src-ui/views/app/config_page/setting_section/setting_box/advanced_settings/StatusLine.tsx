import type { ReactNode } from "react";
import { EnvReadout } from "../_components/env_readout/EnvReadout";
import type { EnvReadoutTone } from "../_components/env_readout/EnvReadout";

export type StatusTone = "active" | "pending" | "failed" | "idle";
const tones: Readonly<Record<StatusTone, EnvReadoutTone>> = { active: "active", pending: "warning", failed: "failed", idle: "neutral" };

// One line at the top of a feature page that says what it is doing now, as an
// environment readout; tone is "active", "pending", "failed" or "idle".
export interface StatusLineProps {
    tone?: StatusTone;
    children?: ReactNode;
    actions?: ReactNode;
}

export const StatusLine = ({ tone = "idle", children, actions = null }: StatusLineProps) =>
    <EnvReadout tone={tones[tone] ?? "neutral"} actions={actions}><p>{children}</p></EnvReadout>;

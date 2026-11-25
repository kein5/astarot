import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge, type BadgeProps } from "../kit/index.ts";
import { Example, T } from "./CatalogParts.tsx";
import * as styles from "./Catalog.css.ts";

// shadcn/ui's Badge in the look the catalogs' badges have (D-29): square corners and a short word
// that says a state. The tone, the variant and the mark only repeat the words, so each example
// carries the words the app shows with that look.

type Look = Pick<BadgeProps, "tone" | "variant" | "mark">;

// Each look as the catalogs use it, with its words.
const TONES: readonly (Look & { words: string })[] = [
    { tone: "neutral", words: "translation_catalog.badge.builtin" },
    { tone: "accent", words: "model_catalog.fits_memory" },
    { tone: "strong", variant: "dashed", words: "translation_catalog.badge.user" },
    { tone: "active", words: "model_catalog.engine.state.connected" },
    { tone: "warning", words: "model_catalog.engine.state.checking" },
    { tone: "failed", words: "translation_catalog.state.missing" },
    { tone: "warning", mark: "alert", words: "model_catalog.hardware_warning.badge" },
];

// A card's state at the end of its name's line: whether the thing is on the PC is told by the fill
// and the mark as well as by the words.
const STATES: readonly (Look & { words: string })[] = [
    { tone: "muted", mark: "ring", words: "model_catalog.status.not_downloaded" },
    { variant: "solid", mark: "check", words: "model_catalog.status.downloaded" },
    { tone: "active", variant: "tint", mark: "check", words: "model_catalog.status.ready" },
    { tone: "active", variant: "solid", mark: "check", words: "model_catalog.status.in_use" },
];

const name = ({ tone, variant, mark }: Look) => [tone && `tone=${tone}`, variant && `variant=${variant}`, mark && `mark=${mark}`]
    .filter(Boolean).join(" ") || "default";

const Looks = ({ looks }: { looks: readonly (Look & { words: string })[] }) => (
    <div className={styles.row}>
        {looks.map(({ words, ...look }) => (
            <Example key={name(look)} name={name(look)}>
                <Badge {...look}><T k={words} /></Badge>
            </Example>
        ))}
    </div>
);

const meta = {
    title: "Kit/Badge",
    component: Badge,
    argTypes: {
        tone: { control: "select", options: ["neutral", "muted", "strong", "accent", "active", "warning", "failed"] },
        variant: { control: "inline-radio", options: ["outline", "solid", "tint", "dashed"] },
        mark: { control: "inline-radio", options: [undefined, "check", "ring", "alert"] },
    },
    args: { tone: "neutral", variant: "outline" },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { render: args => <Badge {...args}><T k="model_catalog.status.downloaded" /></Badge> };

export const Tones: Story = { render: () => <Looks looks={TONES} /> };

export const States: Story = { render: () => <Looks looks={STATES} /> };

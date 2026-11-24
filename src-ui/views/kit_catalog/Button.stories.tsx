import type { Meta, StoryObj } from "@storybook/react-vite";
import { useI18n } from "@useI18n";
import RefreshSvg from "@images/refresh.svg?react";
import { Button, type ButtonProps } from "../kit/index.ts";
import { Example, T } from "./CatalogParts.tsx";
import * as styles from "./Catalog.css.ts";

// The four looks and three sizes of Button.css.ts (DESIGN.md, #474), with the words the app's
// buttons carry. Hover, press and keyboard focus show when you use them.

const TONES = ["primary", "plain", "quiet", "danger"] as const;
const SIZES = ["regular", "compact", "icon"] as const;
type Tone = (typeof TONES)[number];

// What each look is for in the app, as its words.
const WORDS: Record<Tone, string> = {
    primary: "voice_ui.save_changes",
    plain: "model_downloads.review",
    quiet: "voice_ui.discard",
    danger: "realtime.vocabulary_remove_short",
};

const Refresh = () => <RefreshSvg className={styles.icon} aria-hidden="true" />;

// An icon-only button is named by its aria-label.
const IconButton = (props: ButtonProps) => {
    const { t } = useI18n();
    return <Button {...props} size="icon" aria-label={t("realtime.refresh_devices")}><Refresh /></Button>;
};

const meta = {
    title: "Kit/Button",
    component: Button,
    argTypes: {
        tone: { control: "inline-radio", options: TONES },
        size: { control: "inline-radio", options: SIZES },
        disabled: { control: "boolean" },
        children: { control: "text", description: "The label; empty shows the app's \"Save changes\"" },
    },
    args: { tone: "primary", size: "regular", disabled: false },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    render: ({ children, size, ...args }) => size === "icon"
        ? <IconButton {...args} />
        : <Button {...args} size={size}>{children || <T k={WORDS.primary} />}</Button>,
};

const Tones = ({ disabled = false }: { disabled?: boolean }) => (
    <div className={styles.row}>
        {TONES.map(tone => (
            <Example key={tone} name={tone}>
                <Button tone={tone} disabled={disabled}><T k={WORDS[tone]} /></Button>
            </Example>
        ))}
    </div>
);

export const AllTones: Story = { render: () => <Tones /> };

export const Sizes: Story = {
    render: () => (
        <div className={styles.stack}>
            {TONES.map(tone => (
                <div key={tone} className={styles.row}>
                    <Example name={`${tone} regular`}><Button tone={tone}><T k={WORDS[tone]} /></Button></Example>
                    <Example name={`${tone} compact`}><Button tone={tone} size="compact"><T k={WORDS[tone]} /></Button></Example>
                    <Example name={`${tone} icon`}><IconButton tone={tone} /></Example>
                </div>
            ))}
        </div>
    ),
};

// An icon at the start of the label narrows the button's sides (shadcn/ui's has-[>svg]:px-3).
export const WithIcon: Story = {
    render: () => (
        <div className={styles.row}>
            <Example name="regular"><Button><Refresh /><T k="realtime.refresh_devices" /></Button></Example>
            <Example name="compact"><Button size="compact"><Refresh /><T k="realtime.refresh_devices" /></Button></Example>
            <Example name="icon"><IconButton /></Example>
        </div>
    ),
};

// Half as strong (disabledLook), its words and place kept.
export const Disabled: Story = { render: () => <Tones disabled /> };

// A long label wraps inside the button instead of widening the row.
export const LongLabel: Story = {
    render: () => (
        <div className={styles.narrowBox}>
            <Button tone="primary"><T k="config_page.appearance.send_message_button_type.show_and_disable_enter_key" /></Button>
        </div>
    ),
};

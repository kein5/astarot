import type { Meta, StoryObj } from "@storybook/react-vite";
import { useI18n } from "@useI18n";
import { Textarea, type TextareaProps } from "../kit/index.ts";
import { Example } from "./CatalogParts.tsx";
import * as styles from "./Catalog.css.ts";

// The text field of Field.css.ts in several lines. It does not grow with its text (D-13): in a form
// it starts at 8rem and its lower edge can be dragged down; with fill it takes the room its screen
// gives it, as Quick Chat's message field takes the window. With inFrame it has no frame of its own
// and sits in one its screen draws, as the main window's composer field does. A label names it in
// the app; alone here, an aria-label does, with the app's words.

const Instruction = (props: TextareaProps) => {
    const { t } = useI18n();
    return <Textarea aria-label={t("voice_ui.instruction")} rows={3}
        placeholder={t("voice_ui.example", { value: t("voice_ui.instruction_example") })} {...props} />;
};

const QuickChatMessage = (props: TextareaProps) => {
    const { t } = useI18n();
    return <Textarea aria-label={t("quick_chat.message")} placeholder={t("studio.message_placeholder")} fill className={styles.fillField} {...props} />;
};

const meta = {
    title: "Kit/Textarea",
    component: Textarea,
    argTypes: {
        invalid: { control: "boolean" },
        mono: { control: "boolean" },
        disabled: { control: "boolean" },
        readOnly: { control: "boolean" },
        placeholder: { control: "text" },
        defaultValue: { control: "text" },
    },
    args: { invalid: false, mono: false, disabled: false, readOnly: false },
    decorators: [Story => <div className={styles.fieldBox}><Story /></div>],
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

// The key starts the field again when its default value changes: an uncontrolled textarea does not follow it.
export const Playground: Story = { render: args => <Instruction key={String(args.defaultValue)} {...args} /> };

export const Empty: Story = { render: () => <Instruction /> };

export const Filled: Story = {
    render: function Render() {
        const { t } = useI18n();
        return <Instruction defaultValue={t("voice_ui.instruction_example")} />;
    },
};

// The red border only repeats what the words beside the field say.
export const Invalid: Story = {
    render: function Render() {
        const { t } = useI18n();
        return <Instruction invalid defaultValue={t("voice_ui.instruction_example")} />;
    },
};

export const Disabled: Story = {
    render: function Render() {
        const { t } = useI18n();
        return (
            <div className={styles.stack}>
                <Example name="disabled, empty"><Instruction disabled /></Example>
                <Example name="read-only, while Quick Chat hands the message off"><QuickChatMessage readOnly defaultValue={t("voice_ui.instruction_example")} /></Example>
            </div>
        );
    },
};

// inFrame with fill: the field has no border, fill, focus ring or padding of its own; the frame
// around it (here drawn as the composer draws its own) shows the focus and sets the size of its words.
const Composer = (props: TextareaProps) => {
    const { t } = useI18n();
    return (
        <div className={styles.composerFrame}>
            <Textarea aria-label={t("studio.message_input")} placeholder={t("studio.message_placeholder")} inFrame fill
                className={styles.composerField} {...props} />
        </div>
    );
};

export const InFrame: Story = {
    decorators: [Story => <div className={styles.wideStack}><Story /></div>],
    render: function Render() {
        const { t } = useI18n();
        return (
            <>
                <Example name="inFrame, empty"><Composer /></Example>
                <Example name="inFrame, filled"><Composer defaultValue={t("voice_ui.instruction_example")} /></Example>
            </>
        );
    },
};

// fill: no edge to drag; the box's height is the field's (Quick Chat's window).
export const Fill: Story = {
    decorators: [Story => <div className={styles.fillBox}><Story /></div>],
    render: () => <QuickChatMessage />,
};

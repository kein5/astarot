import type { Meta, StoryObj } from "@storybook/react-vite";
import { useI18n } from "@useI18n";
import { Progress, type ProgressProps } from "../kit/index.ts";
import { Example } from "./CatalogParts.tsx";
import * as styles from "./Catalog.css.ts";

// A download's progress, drawn in the app under the readout that says the amount in words: a dark
// track and the value in primary_500, the same palette at two lightnesses (D-32). Each bar is named
// after what it counts, with the app's words.

const ModelDownload = (props: ProgressProps) => {
    const { t } = useI18n();
    return <Progress aria-label={t("model_downloads.progress")} {...props} />;
};

const RuntimeSetup = (props: ProgressProps) => {
    const { t } = useI18n();
    return <Progress aria-label={t("vc_runtime.progress")} {...props} />;
};

const meta = {
    title: "Kit/Progress",
    component: Progress,
    argTypes: {
        value: { control: { type: "range", min: 0, max: 100, step: 1 } },
        max: { control: "number" },
    },
    args: { value: 40, max: 100 },
    decorators: [Story => <div className={styles.fieldBox}><Story /></div>],
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { render: args => <ModelDownload {...args} /> };

// Bytes of a model download, steps of a runtime setup, and a bar without a value: it does not
// know how far it is yet (indeterminate), as a download before its size is known.
export const States: Story = {
    render: () => (
        <div className={styles.wideStack}>
            <Example name="value 0"><ModelDownload value={0} max={1073741824} /></Example>
            <Example name="value 0.4 of 1"><ModelDownload value={429496730} max={1073741824} /></Example>
            <Example name="steps 3 of 9"><RuntimeSetup value={3} max={9} /></Example>
            <Example name="value = max"><ModelDownload value={1073741824} max={1073741824} /></Example>
            <Example name="no value (indeterminate)"><ModelDownload /></Example>
        </div>
    ),
};

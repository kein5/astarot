import type { Meta, StoryObj } from "@storybook/react-vite";
import { useI18n } from "@useI18n";
import { Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../kit/index.ts";
import { Example } from "./CatalogParts.tsx";
import * as styles from "./Catalog.css.ts";

// shadcn/ui's Card in the look the catalogs' cards have (D-28): one unit, such as a speech engine, in
// a quiet frame with no fill and no shadow. The one in use carries the active frame and the lilac
// tint. How cards line up (the catalogs' grid and list) is the screen's layout, not the card's.

// A speech engine's card, as the text-to-speech catalog draws it: its name with its state at the end
// of the line, what it is, a fact, and its action.
const EngineCard = ({ active = false }: { active?: boolean }) => {
    const { t } = useI18n();
    return (
        <div className={styles.cardBox}>
            <Card active={active}>
                <CardHeader>
                    <div className={styles.nameLine}>
                        {/* A product's name, the same in every language. */}
                        <CardTitle>VOICEVOX</CardTitle>
                        {active ? <Badge tone="active">{t("model_catalog.status.in_use")}</Badge> : null}
                        <Badge className={styles.lineEnd} tone={active ? "active" : "warning"}>
                            {t(active ? "model_catalog.engine.state.connected" : "model_catalog.engine.state.not_connected")}
                        </Badge>
                    </div>
                    <CardDescription>{t("model_catalog.engine.summary.voicevox")}</CardDescription>
                </CardHeader>
                <CardContent>
                    <p>{t("model_catalog.languages")}: {t("model_catalog.engine.languages")}</p>
                </CardContent>
                <CardFooter>
                    <div><Button>{t("voice_ui.engine.recheck")}</Button></div>
                </CardFooter>
            </Card>
        </div>
    );
};

const meta = {
    title: "Kit/Card",
    component: Card,
    argTypes: { active: { control: "boolean" } },
    args: { active: false },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { render: ({ active }) => <EngineCard active={active} /> };

export const States: Story = {
    render: () => (
        <div className={styles.stack}>
            <Example name="active=false"><EngineCard /></Example>
            <Example name="active"><EngineCard active /></Example>
        </div>
    ),
};

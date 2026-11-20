import { Hint } from "../_components/hint/Hint";
import styles from "./VoiceSettings.module.scss";

// A heading of the model catalog. On a page reviewed against #614 (DESIGN.md "Principles"), what
// the part is for and how to choose in it are the heading's hint, whose mark takes focus as a
// heading's does; elsewhere (the translation review) they stay lines under the heading. Called as
// a function, so the heading stays an element of the catalog it heads.
// hints: whether the page shows descriptions as hints (useHintDescriptions).
export const catalogHeading = (hints: boolean, level: "h3" | "h4", title: string, help: readonly string[], id?: string) => {
    const Heading = level;
    return hints && help.length > 0
        ? <Heading id={id}><span className={styles.hinted} data-hint-host><span>{title}</span><Hint text={help.join("\n")} focusable /></span></Heading>
        : <><Heading id={id}>{title}</Heading>{help.map(text => <p key={text}>{text}</p>)}</>;
};

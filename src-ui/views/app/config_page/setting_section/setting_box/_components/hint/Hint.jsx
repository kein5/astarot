import { createContext, useContext } from "react";
import HelpSvg from "@images/help.svg?react";
import styles from "./Hint.module.scss";

// The layout explains, not the text (#614, DESIGN.md "Principles"): on a page reviewed against
// it, a setting's general description is not kept on screen. A small question mark follows the
// item label, and the words open in a bubble while the pointer is on the label or the row has
// keyboard focus. The words stay the control's accessible description: aria-describedby still
// reads the bubble while it is hidden.
//
// A page turns this on for its rows by wrapping them in <HintDescriptions>. What must be seen
// before acting (consent, a warning, the value in use) is kept on screen by the row that shows it.
const HintContext = createContext(false);

export const HintDescriptions = ({ children }) => <HintContext.Provider value={true}>{children}</HintContext.Provider>;

export const useHintDescriptions = () => useContext(HintContext);

// row: the hint of a row's label, also opened by keyboard focus anywhere in the row
// ([data-hint-row]). Otherwise only its own host ([data-hint-host]) opens it, such as one
// option of a choice, so focus on one option does not open the bubbles of the others.
// The bubble is aria-hidden: it is read once, as the description its id gives the control
// (a hidden node referenced by aria-describedby is still read), and never as part of a name,
// even inside the <label> of an option.
// focusable: a hint no control points at, such as a section heading's. Its mark takes keyboard
// focus, which opens the bubble, and carries the words as its own name.
export const Hint = ({ text, id, row = false, focusable = false }) => (
    <span className={styles.hint} data-hint>
        {focusable
            ? <span className={styles.focus_mark} tabIndex={0} role="img" aria-label={text}><HelpSvg className={styles.mark} aria-hidden="true" /></span>
            : <HelpSvg className={styles.mark} aria-hidden="true" />}
        <span id={id} role="tooltip" aria-hidden="true" data-slot="tooltip-content" className={row ? `${styles.tip} ${styles.tip_row}` : styles.tip}>{text}</span>
    </span>
);

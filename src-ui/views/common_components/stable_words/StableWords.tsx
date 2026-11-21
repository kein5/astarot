import * as styles from "./StableWords.css.ts";

export type StableWordsProps = {
    // Every word the place may show: a button's "send" and "stop", a readout's states.
    words: readonly string[];
    // The one shown now; it is added if it is not among them.
    current: string;
};

// Words that change with a state, drawn in the space the longest of them needs, so the control
// and what follows it do not move when the state changes (#912). The words lie in one cell; only
// the current one is seen and read, in the middle of the cell, and the others keep their width hidden.
export const StableWords = ({ words, current }: StableWordsProps) => {
    const all = words.includes(current) ? words : [...words, current];
    return (
        <span className={styles.stack}>
            {all.map(word => <span key={word} className={styles.word} aria-hidden={word === current ? undefined : true}>{word}</span>)}
        </span>
    );
};

import * as styles from "./FieldProblem.css.ts";

// What is wrong with a field's value and what kind of value would do, in words under the field
// (#1111). The field names it in its aria-describedby by `id` and is aria-invalid meanwhile.
export const FieldProblem = ({ id, text }: { id: string; text: string }) => (
    <p id={id} role="alert" className={styles.problem}>{text}</p>
);

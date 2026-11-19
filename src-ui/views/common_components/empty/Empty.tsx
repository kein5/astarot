import type { HTMLAttributes } from "react";
import clsx from "clsx";
import * as styles from "./Empty.css.ts";

// shadcn/ui's Empty (DESIGN.md "Components"): what a list or a panel shows when it has nothing
// to show, such as a search that found nothing. Only the parts the app uses are written;
// EmptyHeader, EmptyMedia, EmptyTitle and EmptyContent come when a screen needs them.
export const Empty = ({ className, ...rest }: HTMLAttributes<HTMLDivElement>) => (
    <div data-slot="empty" className={clsx(styles.empty, className)} {...rest} />
);

// One sentence, so a paragraph (shadcn/ui draws its description as a <div>).
export const EmptyDescription = ({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) => (
    <p data-slot="empty-description" className={clsx(styles.description, className)} {...rest} />
);

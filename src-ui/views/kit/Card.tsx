import type { ComponentProps } from "react";
import clsx from "clsx";
import * as styles from "./Card.css.ts";

// shadcn/ui's Card, in the parts it is written with and their data-slot (DESIGN.md "Components"),
// in the look the catalogs' cards had (D-28). A ref is one of the props, as React 19 passes it.

type CardLook = {
    // The one in use among its kind: the active frame and the lilac tint.
    active?: boolean;
};
// The element the card is: a <div>, or an <li> when the card is one item of a list (the catalogs).
export type CardProps = CardLook & ((ComponentProps<"div"> & { as?: "div" }) | (ComponentProps<"li"> & { as: "li" }));

export function Card(props: CardProps) {
    if (props.as === "li") {
        const { as, active, className, ...rest } = props;
        return <li data-slot="card" className={clsx(styles.card({ active }), className)} {...rest} />;
    }
    const { as, active, className, ...rest } = props;
    return <div data-slot="card" className={clsx(styles.card({ active }), className)} {...rest} />;
}

export const CardHeader = ({ className, ...rest }: ComponentProps<"div">) => (
    <div data-slot="card-header" className={clsx(styles.header, className)} {...rest} />
);

export const CardTitle = ({ className, ...rest }: ComponentProps<"div">) => (
    <div data-slot="card-title" className={clsx(styles.title, className)} {...rest} />
);

export const CardDescription = ({ className, ...rest }: ComponentProps<"div">) => (
    <div data-slot="card-description" className={clsx(styles.description, className)} {...rest} />
);

export const CardContent = ({ className, ...rest }: ComponentProps<"div">) => (
    <div data-slot="card-content" className={clsx(styles.content, className)} {...rest} />
);

export const CardFooter = ({ className, ...rest }: ComponentProps<"div">) => (
    <div data-slot="card-footer" className={clsx(styles.footer, className)} {...rest} />
);

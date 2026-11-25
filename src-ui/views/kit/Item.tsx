import type { ComponentProps } from "react";
import clsx from "clsx";
import * as styles from "./Item.css.ts";

// shadcn/ui's Item, in the parts it is written with and with the data-slot of each (DESIGN.md
// "Components"). The group is a <ul> and an item an <li>, as the app's lists were: a screen reader
// says how many rows there are. A ref is one of the props, as React 19 passes it.

export type ItemGroupProps = ComponentProps<"ul"> & styles.ItemGroupVariants;

export function ItemGroup({ variant, size, className, ...rest }: ItemGroupProps) {
    return <ul data-slot="item-group" className={clsx(styles.group({ variant, size }), className)} {...rest} />;
}

export type ItemProps = ComponentProps<"li"> & styles.ItemVariants;

// data-variant and data-size say the look, as shadcn/ui's Item does.
export function Item({ variant = "default", size = "default", className, ...rest }: ItemProps) {
    return <li data-slot="item" data-variant={variant} data-size={size} className={clsx(styles.item({ variant, size }), className)} {...rest} />;
}

// The states a row's mark shows (DESIGN.md "Components"). ready: nothing to do; attention: the user
// has something to do, which the row's words say; checking: not known yet; neutral: neither, such
// as a choice made elsewhere.
export type ItemState = "ready" | "attention" | "checking" | "neutral";

export type ItemMediaProps = ComponentProps<"div"> & {
    // Draws the mark of this state in place of children. The mark only repeats what the row's words
    // say, so it is hidden from screen readers.
    state?: ItemState;
};

export function ItemMedia({ state, className, children, ...rest }: ItemMediaProps) {
    return (
        <div data-slot="item-media" data-state={state} aria-hidden={state ? "true" : undefined} className={clsx(styles.media, className)} {...rest}>
            {state ? <StateMark state={state} /> : children}
        </div>
    );
}

const StateMark = ({ state }: { state: ItemState }) => (
    <svg viewBox="0 0 16 16" className={styles.mediaSvg} aria-hidden="true">
        {state === "ready" && <>
            <circle className={styles.markShape.ready} cx="8" cy="8" r="7" />
            <path className={styles.markShape.glyph} d="M4.6 8.3l2.3 2.3 4.5-4.6" />
        </>}
        {state === "attention" && <>
            <circle className={styles.markShape.attention} cx="8" cy="8" r="7" />
            <path className={styles.markShape.glyph} d="M8 4.4v4.4M8 11.4v.2" />
        </>}
        {state === "checking" && <circle className={styles.markShape.arc} cx="8" cy="8" r="6" />}
        {state === "neutral" && <circle className={styles.markShape.ring} cx="8" cy="8" r="6.2" />}
    </svg>
);

export const ItemContent = ({ className, ...rest }: ComponentProps<"div">) => (
    <div data-slot="item-content" className={clsx(styles.content, className)} {...rest} />
);

export const ItemTitle = ({ className, ...rest }: ComponentProps<"div">) => (
    <div data-slot="item-title" className={clsx(styles.title, className)} {...rest} />
);

// A <div>, not shadcn/ui's <p>: it may hold lines of its own (Item.css.ts).
export const ItemDescription = ({ className, ...rest }: ComponentProps<"div">) => (
    <div data-slot="item-description" className={clsx(styles.description, className)} {...rest} />
);

export const ItemActions = ({ className, ...rest }: ComponentProps<"div">) => (
    <div data-slot="item-actions" className={clsx(styles.actions, className)} {...rest} />
);

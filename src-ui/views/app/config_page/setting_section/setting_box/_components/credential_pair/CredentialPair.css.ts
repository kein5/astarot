import { style } from "@vanilla-extract/css";

// The pair's two rows stay rows of the page; the element only tells focus moving between them from
// focus leaving the pair (#1111).
export const pair = style({ display: "contents" });

import { style } from "@vanilla-extract/css";

export const container = style({
    display: "flex",
    flexDirection: "column",
});
// The way to the chat reading page, under its heading: the shared page button (PageLinkButton)
// with the room the page's last section keeps below it.
export const chat_reading_link = style({
    margin: "1.2rem 0 2.4rem",
});

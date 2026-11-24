import { style } from "@vanilla-extract/css";
import type { StyleRule } from "@vanilla-extract/css";
import { vars } from "../../../../../theme/vars.css.ts";

export const container = style({
    display: "flex",
    gap: "2.2rem",
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "column",
    maxWidth: "72rem",
    margin: "auto",
});

export const vrct_vox_section = style({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1rem",
    width: "100%",
});
export const vrct_vox_logo = style({
    width: "100%",
    maxWidth: "44rem",
    height: "auto",
});
// The official subtitle (ADR-011). Outfit is used only when it is installed; no font is fetched.
export const vrct_vox_subtitle = style({
    fontFamily: `Outfit, ${vars.font_family}, "Noto Sans", system-ui, sans-serif`,
    fontSize: "1.5rem",
    fontWeight: 700,
    lineHeight: 1.4,
    textAlign: "center",
    color: vars.dark_300_color,
});
export const vrct_vox_version = style({
    fontSize: "1.4rem",
    color: vars.dark_400_color,
});
export const vrct_vox_text = style({
    fontSize: "1.4rem",
    lineHeight: 1.7,
    color: vars.dark_200_color,
    width: "100%",
});
export const vrct_vox_links = style({
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: "0.8rem",
    marginTop: "0.6rem",
});
export const vrct_vox_link = style({
    fontSize: "1.4rem",
    padding: "0.6rem 1.4rem",
    borderRadius: "0.4rem",
    color: vars.primary_200_color,
    backgroundColor: vars.dark_850_color,
    selectors: {
        "&:hover": { backgroundColor: vars.dark_800_color },
        "&:active": { backgroundColor: vars.dark_900_color },
    },
});
export const original_heading = style({
    fontSize: "1.6rem",
    marginTop: "2rem",
    width: "100%",
    color: vars.dark_300_color,
    borderTop: `0.1rem solid ${vars.dark_750_color}`,
    paddingTop: "2.4rem",
});

export const contributors = style({});
export const special_thanks = style({});
export const section_title = style({
    width: "auto",
    height: "1.2rem",
    alignSelf: "flex-start",
    objectFit: "contain",
    objectPosition: "left",
    selectors: {
        [`&.${contributors}`]: { marginBottom: "0.8rem" },
        [`&.${special_thanks}`]: { marginBottom: "0.6rem" },
    },
});

export const project_links_and_logo_section = style({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: "100%",
    gap: "1rem",
});
export const about_vrct_logo_wrapper = style({
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    padding: "1.2rem 0 0.4rem",
});
export const about_vrct_logo = style({
    width: "20rem",
    height: "auto",
    objectFit: "contain",
});
export const project_links_wrapper = style({
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: "0.4rem 1.2rem",
    alignItems: "center",
});

export const project_link = style({
    height: "2.6rem",
    padding: "0.4rem 1rem",
    borderRadius: "0.4rem",
    flexShrink: 0,
    selectors: {
        "&:hover": { backgroundColor: vars.dark_850_color },
        "&:active": { backgroundColor: vars.dark_900_color },
    },
});

export const contributors_img_wrapper = style({
    display: "flex",
    flexWrap: "wrap",
    gap: "1rem",
    justifyContent: "center",
    alignItems: "center",
});
export const contributor_card_wrapper = style({
    position: "relative",
});
export const contributors_img = style({
    width: "22rem",
    height: "auto",
});

// A contributor's link on their card: 16% from the bottom, .8rem from the left (or either side of it).
const contributorSns = (left: string): StyleRule => ({
    position: "absolute",
    left,
    bottom: "16%",
    width: "2.4rem",
    padding: "0.4rem",
    borderRadius: "0.4rem",
    transform: "translate(50%, 50%)",
    selectors: {
        "&:hover": { backgroundColor: vars.dark_825_color },
        "&:active": { backgroundColor: vars.dark_888_color },
    },
});
export const contributors_done_san_x = style(contributorSns("0.8rem"));
export const contributors_iya_x = style(contributorSns("0.8rem"));
export const contributors_rera_x = style(contributorSns("-0.6rem"));
export const contributors_rera_github = style(contributorSns("2.2rem"));
export const contributors_poposuke_x = style(contributorSns("0.8rem"));
export const contributors_kumaguma_x = style(contributorSns("0.8rem"));
export const contributors_riku_x = style(contributorSns("0.8rem"));

export const special_thanks_section = style({
    display: "flex",
    flexDirection: "column",
    width: "100%",
});
export const special_thanks_members_img = style({
    width: "100%",
    height: "auto",
    marginBottom: "0.4rem",
});
export const special_thanks_message_img = style({
    width: "100%",
    height: "auto",
});

export const vrchat_disclaimer = style({
    fontSize: "1.2rem",
    marginTop: "8rem",
    color: vars.dark_600_color,
});

export const vrchat_disclaimer_translation = style({
    fontSize: "1.2rem",
    marginTop: "0.8rem",
    color: vars.dark_600_color,
});

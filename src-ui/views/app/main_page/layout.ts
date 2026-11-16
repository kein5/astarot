// The main page's layout is decided by the size of its regions, not of the window (layout
// audit, docs/design/main-layout-revision). MainPage and MainSection are size containers
// under these names; the styles inside them query the names and the sizes below. The SCSS
// modules not yet moved to vanilla-extract (ADR-010) write the same names and sizes literally.

/** The whole page under the title bar: the rail and the conversation column. */
export const MAIN_PAGE_CONTAINER = "main_page";
/** The conversation column beside the rail. */
export const MAIN_SECTION_CONTAINER = "main_section";

/** A column this narrow draws the top bar's shortest words. rem follows the UI size. */
export const NARROW_COLUMN = "64rem";
/** A region this short gives its height to the conversation (the 200px minimum window included). */
export const SHORT_REGION = "36rem";

/** The height the rows that line up with the top bar take in a short region. */
export const SHORT_TOPBAR_HEIGHT = "4.4rem";

export const shorterThan = (container: string): string => `${container} (max-height: ${SHORT_REGION})`;

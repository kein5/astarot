import { globalKeyframes, globalStyle } from "@vanilla-extract/css";
import { vars } from "../../../theme/vars.css.ts";

// react-toastify's look, set for the app over the library's own styles. Global: the library's
// class names and the transition classes (fade_in, fade_out) SnackbarController names.
globalStyle(":root", {
    vars: {
        "--toastify-color-light": "#fff",
        "--toastify-color-dark": vars.dark_950_color,
        "--toastify-color-info": vars.sent_400_color,
        "--toastify-color-success": vars.primary_400_color,
        "--toastify-color-warning": vars.warning_bc_color,
        "--toastify-color-error": vars.error_bc_color,
        "--toastify-color-transparent": "rgba(255, 255, 255, 0.7)",

        "--toastify-icon-color-info": "var(--toastify-color-info)",
        "--toastify-icon-color-success": "var(--toastify-color-success)",
        "--toastify-icon-color-warning": "var(--toastify-color-warning)",
        "--toastify-icon-color-error": "var(--toastify-color-error)",

        "--toastify-container-width": "fit-content",
        "--toastify-toast-width": "32rem",
        "--toastify-toast-offset": "1.6rem",
        // On the main page, notices sit at the top of the content column, under the
        // top bar. Nothing there is a control: it is the oldest end of the log. At
        // the bottom left they covered the lower sidebar and the message box. On a
        // first run, the notice that says "open Settings" hid the settings button
        // for ten seconds. In settings they move down (SnackbarController.css.ts).
        // 24rem is the main sidebar (the settings sidebar is narrower). A window too
        // narrow for a readable notice beside it lets the notice slide over the sidebar.
        "--toastify-toast-top": `calc(${vars.title_bar_height} + ${vars.config_page_content_padding_top} + 2.4rem)`,
        "--toastify-toast-right": "max(var(--toastify-toast-offset), env(safe-area-inset-right))",
        "--toastify-toast-left": "max(var(--toastify-toast-offset), min(calc(24rem + var(--toastify-toast-offset)), calc(100vw - 32rem - var(--toastify-toast-offset))))",
        "--toastify-toast-bottom": "max(var(--toastify-toast-offset), env(safe-area-inset-bottom))",
        "--toastify-toast-background": "#fff",
        "--toastify-toast-padding": "1.4rem",
        "--toastify-toast-min-height": "6.4rem",
        "--toastify-toast-max-height": "80rem",
        "--toastify-toast-bd-radius": "0.6rem",
        "--toastify-toast-shadow": ".0 0.4rem 1.2rem rgba(0, 0, 0, 0.1)",
        // The same stack as the rest of the window (root.css): with the chosen font alone, a PC without it
        // drew the notices' Latin text in the browser's default serif font (#1314, M-10).
        "--toastify-font-family": `${vars.font_family}, "Noto Sans", system-ui, sans-serif`,
        "--toastify-z-index": "9999",
        "--toastify-text-color-light": "#757575",
        "--toastify-text-color-dark": vars.dark_basic_text_color,

        // Used only for the coloured theme.
        "--toastify-text-color-info": vars.dark_basic_text_color,
        "--toastify-text-color-success": vars.dark_basic_text_color,
        "--toastify-text-color-warning": vars.dark_basic_text_color,
        "--toastify-text-color-error": vars.dark_basic_text_color,

        "--toastify-spinner-color": "#616161",
        "--toastify-spinner-color-empty-area": "#e0e0e0",
        "--toastify-color-progress-light": "linear-gradient(to right, #4cd964, #5ac8fa, #007aff, #34aadc, #5856d6, #ff2d55)",
        "--toastify-color-progress-dark": "#bb86fc",
        "--toastify-color-progress-info": "var(--toastify-color-info)",
        "--toastify-color-progress-success": "var(--toastify-color-success)",
        "--toastify-color-progress-warning": "var(--toastify-color-warning)",
        "--toastify-color-progress-error": "var(--toastify-color-error)",
        // The opacity of the progress trail.
        "--toastify-color-progress-bgo": "0.2",
    },
});

// Below 480px the library moves the container to the very top of the window,
// over the title bar and its close button. Keep it under the top bars.
const NARROW = "only screen and (max-width: 480px)";
globalStyle(".Toastify__toast-container--top-left", {
    "@media": { [NARROW]: { top: "var(--toastify-toast-top)" } },
});
// The container spans the window here; a notice kept narrow only grows taller.
globalStyle(".Toastify__toast-container .Toastify__toast", {
    "@media": { [NARROW]: { maxWidth: "100vw" } },
});

globalStyle(".Toastify__toast", {
    // The library's defaults, kept where they are not overridden below (the others,
    // left out, were width, padding, font-family, z-index, display, flex and align-items).
    position: "relative",
    touchAction: "none",
    minHeight: "var(--toastify-toast-min-height)",
    boxSizing: "border-box",
    marginBottom: "1rem",
    borderRadius: vars.vox_radius,
    boxShadow: "none",
    maxHeight: "var(--toastify-toast-max-height)",
    wordBreak: "break-word",

    // The app's own.
    overflow: "hidden",
    display: "flex",
    justifyContent: "start",
    alignItems: "center",
    fontSize: "1.4rem",
    width: "fit-content",
    maxWidth: "calc(100vw - var(--toastify-toast-left) - var(--toastify-toast-offset))",
    paddingRight: "4rem",
    backgroundColor: vars.dark_950_color,
    gap: "0.6rem",
    whiteSpace: "pre-wrap",
});

globalStyle(".Toastify__progress-bar--wrp", { height: "0.4rem" });
globalStyle(".Toastify__progress-bar--success", { background: vars.success_bc_color });
globalStyle(".Toastify__progress-bar--warning", { background: vars.warning_bc_color });
globalStyle(".Toastify__progress-bar--error", { background: vars.error_bc_color });

globalStyle(".Toastify__toast--error", {
    userSelect: "text",
    WebkitUserSelect: "text",
});
globalStyle(".Toastify__toast--error .Toastify__toast-body", {
    userSelect: "text",
    WebkitUserSelect: "text",
    cursor: "text",
});

globalStyle(".Toastify__toast-icon", {
    width: "fit-content",
    maxWidth: "2.8rem",
    minWidth: "2.8rem",
    justifyContent: "center",
    alignItems: "center",
    userSelect: "none",
    WebkitUserSelect: "none",
});

globalKeyframes("fade_in", {
    "0%": { opacity: 0 },
    "100%": { opacity: 1 },
});
globalKeyframes("fade_out", {
    "0%": { opacity: 1 },
    "100%": { opacity: 0 },
});
globalStyle(".fade_in", {
    opacity: 0,
    animationName: "fade_in",
    animationDuration: "0.1s",
    animationTimingFunction: "ease-out",
    animationFillMode: "forwards",
});
globalStyle(".fade_out", {
    opacity: 1,
    animationName: "fade_out",
    animationDuration: "0.1s",
    animationTimingFunction: "ease-in",
    animationFillMode: "forwards",
});

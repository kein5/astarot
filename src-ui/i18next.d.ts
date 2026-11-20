// The locale files are YAML read at run time, so i18next has no types for their keys and cannot
// tell which variables a message takes. i18next 27 turned strictInterpolationChecks on by default,
// which makes t(key) and t(key, options) separate signatures; the UI's own translate types are one
// function, t(key, options?). Off, t() has the types it had with i18next 26, as its docs advise.
import "i18next";

declare module "i18next" {
    interface CustomTypeOptions {
        strictInterpolationChecks: false;
    }
}

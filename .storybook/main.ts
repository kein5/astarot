import type { StorybookConfig } from "@storybook/react-vite";

// The catalog of the shared UI kit (src-ui/views/kit/), for development only. `npm run dev:catalog`
// serves it and `npm run build:catalog` writes it to build/storybook/. The app's build lists its
// own pages (vite.config.js), so nothing here reaches dist/ or the release packages.
//
// Storybook reads the project's vite.config.js as it is, so the stories are built with the app's
// plugins (vanilla-extract, SVG, YAML) and aliases; it puts its own root and build options in place
// of the app's.
const config: StorybookConfig = {
    stories: ["../src-ui/views/kit_catalog/*.stories.tsx"],
    framework: { name: "@storybook/react-vite", options: {} },
    core: {
        // Nothing leaves the PC: no usage data, no crash reports, no news of Storybook releases.
        disableTelemetry: true,
        enableCrashReports: false,
        disableWhatsNewNotifications: true,
    },
    // The stories say their controls themselves (argTypes), so no prop-type reader runs. It also
    // keeps @joshwooding/vite-plugin-react-docgen-typescript, which only the react-docgen-typescript
    // option loads, out of the process (osv-scanner.toml).
    typescript: { reactDocgen: false },
};

export default config;

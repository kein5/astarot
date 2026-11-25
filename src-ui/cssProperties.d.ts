// Inline styles may set CSS custom properties, as in style={{ "--range-fill": fill }}.
import "react";

declare module "react" {
    interface CSSProperties {
        [property: `--${string}`]: string | number | undefined;
    }
}

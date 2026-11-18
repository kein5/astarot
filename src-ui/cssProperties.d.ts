// Inline styles may set CSS custom properties, as in style={{ "--checkbox-size": size }}.
import "react";

declare module "react" {
    interface CSSProperties {
        [property: `--${string}`]: string | number | undefined;
    }
}

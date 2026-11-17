import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useI18n } from "@useI18n";
import { useStartupProgress } from "../../../../logics/common/useStartupProgress";

// The main page is inert while the engine starts, which also hides it from
// screen readers. This live region, outside it, says that the app is starting
// and which models it is fetching. Percentages stay on screen only, so the
// reader is not interrupted at every step.
// Radix's VisuallyHidden keeps it off screen (ADR-010: behaviour from Radix, looks from vanilla-extract).
export const StartupAnnouncer = () => {
    const { t } = useI18n();
    const { downloads } = useStartupProgress();
    return (
        <VisuallyHidden asChild>
            <p role="status">
                {[t("studio.startup_status"), ...downloads.map(item => t(`studio.startup_download_${item.kind}`, { id: item.id }))].join(" ")}
            </p>
        </VisuallyHidden>
    );
};

import clsx from "clsx";
import styles from "./VersionLabel.module.scss";

import { useI18n } from "@useI18n";
import { useSoftwareVersion, useCopyToClipboard } from "@logics_common";
import CopySvg from "@images/copy.svg?react";
import CheckMarkSvg from "@images/check_mark.svg?react";

// There is one package for every PC (#288), so the label no longer names a CUDA package.
export const VersionLabel = ({ isCompact = false }) => {
    const { t } = useI18n();
    const { currentSoftwareVersion } = useSoftwareVersion();
    const { is_copied, copyToClipboard } = useCopyToClipboard();

    const software_version_number = currentSoftwareVersion.data || "";

    const is_beta = software_version_number.toLowerCase().includes("beta");
    const base_version = software_version_number.split("-")[0];

    const onCopy = () => {
        if (isCompact) return;
        copyToClipboard(`${software_version_number}`);
    };

    return (
        <div
            className={clsx(styles.container, {
                [styles.is_compact]: isCompact,
                [styles.is_beta]: is_beta,
            })}
        >
            <div
                className={clsx(styles.wrapper, {
                    [styles.is_copied]: is_copied,
                    [styles.is_compact]: isCompact,
                })}
                onClick={onCopy}
                {...(isCompact ? {} : {
                    role: "button", tabIndex: 0, "aria-label": t("common.copy_version", { version: software_version_number }),
                    onKeyDown: event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); onCopy(); } },
                })}
            >
                {isCompact ? (
                    <div className={styles.compact_content}>
                        <p className={styles.compact_version_label}>{`v${base_version}`}</p>{/* i18n-exempt: the version number's prefix, the same in every language */}
                        {is_beta && <span className={styles.compact_badge}>Beta</span>}{/* i18n-exempt: a badge for the version's "-beta" suffix, kept as the same mark in every language */}
                    </div>
                ) : (
                    <div className={styles.expanded_row}>
                        <div className={styles.version_text_block}>
                            <p className={styles.version_label}>
                                {`v${software_version_number}`}{/* i18n-exempt: the version number's prefix */}
                            </p>
                        </div>
                        {is_copied ? (
                            <CheckMarkSvg className={styles.check_mark_svg} />
                        ) : (
                            <CopySvg className={styles.copy_svg} />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

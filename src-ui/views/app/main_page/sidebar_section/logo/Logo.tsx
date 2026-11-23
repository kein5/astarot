import * as styles from "./Logo.css.ts";
import { useIsMainPageCompactMode } from "@logics_main";
import SymbolSvg from "@images/brand/symbol.svg?react";
import WordmarkSvg from "@images/brand/wordmark.svg?react";

export const Logo = () => <div className={styles.container}><LogoBox /></div>;

// The ASTAROT symbol and wordmark (docs/brand/astarot); the narrow sidebar keeps the symbol only.
export const LogoBox = () => {
    const { currentIsMainPageCompactMode } = useIsMainPageCompactMode();
    return <div className={styles.wordmark} role="img" aria-label="ASTAROT" translate="no">
        <SymbolSvg className={styles.symbol} aria-hidden="true" />
        {!currentIsMainPageCompactMode.data && <WordmarkSvg className={styles.name} aria-hidden="true" />}
    </div>;
};

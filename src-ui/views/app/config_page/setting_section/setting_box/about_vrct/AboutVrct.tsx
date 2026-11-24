import * as styles from "./AboutVrct.css.ts";
import astarot_logo from "@images/brand/logo.svg";

import vrct_logo_for_about_vrct from "@images/about_vrct/vrct_logo_for_about_vrct.png";

import contributors_section_title from "@images/about_vrct/contributors_section_title.png";
import contributor_done from "@images/about_vrct/contributor_done.png";
import contributor_iya from "@images/about_vrct/contributor_iya.png";
import contributor_rera from "@images/about_vrct/contributor_rera.png";
import contributor_poposuke from "@images/about_vrct/contributor_poposuke.png";
import contributor_kumaguma from "@images/about_vrct/contributor_kumaguma.png";
import contributor_riku from "@images/about_vrct/contributor_riku.png";

import special_thanks_section_title from "@images/about_vrct/special_thanks_section_title.png";
import special_thanks_members from "@images/about_vrct/special_thanks_members.png";
import special_thanks_message_en from "@images/about_vrct/special_thanks_message_en.png";
import special_thanks_message_ja from "@images/about_vrct/special_thanks_message_ja.png";

import clsx from "clsx";
import { useI18n } from "@useI18n";
import { useAppearance } from "@logics_configs";
import { useSoftwareVersion } from "@logics_common";

import { astarot_discord_invite_url, upstream_vrct_document_url } from "@ui_configs";

// The official subtitle is the same in every UI language (ADR-011), so it is not translated.
const ASTAROT_SUBTITLE = "Speech, Translation, Accessibility, Revoicing & OCR Toolkit";

// The repository keeps its current name until it is renamed for 0.5.0.
const vrct_vox_url = "https://github.com/kein5/astarot";
const vrct_vox_links = [
    { id: "repository", href: vrct_vox_url },
    { id: "releases", href: `${vrct_vox_url}/releases` },
    { id: "issues", href: `${vrct_vox_url}/issues` },
    { id: "discord", href: astarot_discord_invite_url },
    { id: "licenses", href: `${vrct_vox_url}/blob/main/NOTICE.md` },
];

// Every picture carries its natural size (width, height), so the page keeps its place before the
// pictures are decoded and nothing below them moves when they arrive (#912).
export const AboutVrct = () => {
    const { t } = useI18n();
    const { currentUiLanguage } = useAppearance();
    const { currentSoftwareVersion } = useSoftwareVersion();
    return (
        <div className={styles.container}>
            <section className={styles.vrct_vox_section}>
                <img src={astarot_logo} width={1474} height={300} className={styles.vrct_vox_logo} alt="ASTAROT" />
                <p className={styles.vrct_vox_subtitle} lang="en" translate="no">{ASTAROT_SUBTITLE}</p>
                {currentSoftwareVersion.data && (
                    <p className={styles.vrct_vox_version}>{t("config_page.common.version", { version: currentSoftwareVersion.data })}</p>
                )}
                <p className={styles.vrct_vox_text}>{t("config_page.about_vrct.summary")}</p>
                <p className={styles.vrct_vox_text}>{t("config_page.about_vrct.fork_notice")}</p>
                <div className={styles.vrct_vox_links}>
                    {vrct_vox_links.map(link => (
                        <a key={link.id} className={styles.vrct_vox_link} href={link.href} target="_blank" rel="noreferrer">
                            {t(`config_page.about_vrct.links.${link.id}`)}
                        </a>
                    ))}
                </div>
            </section>

            <h2 className={styles.original_heading}>{t("config_page.about_vrct.original_heading")}</h2>
            <p className={styles.vrct_vox_text}>{t("config_page.about_vrct.original_desc")}</p>

            <div className={styles.project_links_and_logo_section}>
                <div className={styles.about_vrct_logo_wrapper}>
                    <img src={vrct_logo_for_about_vrct} width={400} height={107} alt="VRCT" className={styles.about_vrct_logo} />
                </div>
                <div className={styles.project_links_wrapper}>
                    <OpenLinkContainer className={styles.project_link} href_id="project_link_documents" />
                    <OpenLinkContainer className={styles.project_link} href_id="project_link_vrct_github" />
                </div>
            </div>

            <div>
                <img src={contributors_section_title} width={180} height={26} alt={t("config_page.about_vrct.credits.contributors_section_title")} className={clsx(styles.section_title, styles.contributors)} />
                <div className={styles.contributors_img_wrapper}>
                    <div className={styles.contributor_card_wrapper}>
                        <img src={contributor_done} width={800} height={360} alt={t("config_page.about_vrct.credits.contributor_done")} className={clsx(styles.contributors_img, styles.contributors)} />
                        <OpenLinkContainer className={styles.contributors_done_san_x} href_id="contributors_done_san_x" />
                    </div>
                    <div className={styles.contributor_card_wrapper}>
                        <img src={contributor_iya} width={800} height={360} alt={t("config_page.about_vrct.credits.contributor_iya")} className={clsx(styles.contributors_img, styles.contributors)} />
                        <OpenLinkContainer className={styles.contributors_iya_x} href_id="contributors_iya_x" />
                    </div>
                    <div className={styles.contributor_card_wrapper}>
                        <img src={contributor_rera} width={800} height={360} alt={t("config_page.about_vrct.credits.contributor_rera")} className={clsx(styles.contributors_img, styles.contributors)} />
                        <OpenLinkContainer className={styles.contributors_rera_x} href_id="contributors_rera_x" />
                        <OpenLinkContainer className={styles.contributors_rera_github} href_id="contributors_rera_github" />
                    </div>
                    <div className={styles.contributor_card_wrapper}>
                        <img src={contributor_poposuke} width={800} height={360} alt={t("config_page.about_vrct.credits.contributor_poposuke")} className={clsx(styles.contributors_img, styles.contributors)} />
                        <OpenLinkContainer className={styles.contributors_poposuke_x} href_id="contributors_poposuke_x" />
                    </div>
                    <div className={styles.contributor_card_wrapper}>
                        <img src={contributor_kumaguma} width={800} height={360} alt={t("config_page.about_vrct.credits.contributor_kumaguma")} className={clsx(styles.contributors_img, styles.contributors)} />
                        <OpenLinkContainer className={styles.contributors_kumaguma_x} href_id="contributors_kumaguma_x" />
                    </div>
                    <div className={styles.contributor_card_wrapper}>
                        <img src={contributor_riku} width={800} height={360} alt={t("config_page.about_vrct.credits.contributor_riku")} className={clsx(styles.contributors_img, styles.contributors)} />
                        <OpenLinkContainer className={styles.contributors_riku_x} href_id="contributors_riku_x" />
                    </div>
                </div>
            </div>

            <div className={styles.special_thanks_section}>
                <img src={special_thanks_section_title} width={202} height={28} alt={t("config_page.about_vrct.credits.special_thanks_section_title")} className={clsx(styles.section_title, styles.special_thanks)} />
                <img src={special_thanks_members} width={1440} height={128} alt={t("config_page.about_vrct.credits.special_thanks_members")} className={styles.special_thanks_members_img} />
                {
                    currentUiLanguage.data === "ja"
                    ? <img src={special_thanks_message_ja} width={1440} height={25} alt={t("config_page.about_vrct.credits.special_thanks_message")} className={styles.special_thanks_message_img} />
                    : <img src={special_thanks_message_en} width={1440} height={27} alt={t("config_page.about_vrct.credits.special_thanks_message")} className={styles.special_thanks_message_img} />
                }
            </div>


            <div>
                {/* VRChat's trademark notice is always shown in its original English wording (from en.yml);
                    lang lets screen readers read it as English. Other UI languages add their translation below it. */}
                <p className={styles.vrchat_disclaimer} lang="en">{t("config_page.about_vrct.vrchat_disclaimer", { lng: "en" })}</p>
                {currentUiLanguage.data !== "en" && (
                    <p className={styles.vrchat_disclaimer_translation}>{t("config_page.about_vrct.vrchat_disclaimer")}</p>
                )}
            </div>


        </div>
    );
};

import contributors_x_icon from "@images/about_vrct/contributors_x_icon.png";
import contributors_github_icon from "@images/about_vrct/contributors_github_icon.png";

import project_link_documents from "@images/about_vrct/project_link_documents.png";
import project_link_vrct_github from "@images/about_vrct/project_link_vrct_github.png";

const about_vrct_links = {
    project_link_documents: { img: project_link_documents, size: [188, 35], href: upstream_vrct_document_url },
    project_link_vrct_github: { img: project_link_vrct_github, size: [428, 35], href: "https://github.com/misyaguziya/VRCT" },

    contributors_done_san_x: { img: contributors_x_icon, size: [32, 32], href: "https://twitter.com/done_vrc" },
    contributors_iya_x: { img: contributors_x_icon, size: [32, 32], href: "https://twitter.com/IYAA_HHHH" },
    contributors_rera_x: { img: contributors_x_icon, size: [32, 32], href: "https://twitter.com/rerassi" },
    contributors_rera_github: { img: contributors_github_icon, size: [32, 32], href: "https://github.com/soumt-r" },
    contributors_poposuke_x: { img: contributors_x_icon, size: [32, 32], href: "https://twitter.com/sig_popo" },
    contributors_kumaguma_x: { img: contributors_x_icon, size: [32, 32], href: "https://twitter.com/K_kumaguma_A" },
    contributors_riku_x: { img: contributors_x_icon, size: [32, 32], href: "https://twitter.com/Riku7302" },
};

type OpenLinkContainerProps = {
    className?: string;
    href_id: keyof typeof about_vrct_links;
};

const OpenLinkContainer = ({className, href_id}: OpenLinkContainerProps) => {
    const { t } = useI18n();
    const { currentUiLanguage } = useAppearance();
    const link = about_vrct_links[href_id];
    const href = typeof link.href === "function" ? link.href(currentUiLanguage.data) : link.href;
    const img = link.img;
    return (
        <a aria-label={t(`config_page.about_vrct.image_links.${href_id}`)} className={className} href={href} target="_blank" rel="noreferrer" >
            {/* for adjust size to their parent component's width. Its natural size keeps the place before it is decoded. */}
            <img style={ {height: "100%", width: "100%", "objectFit": "contain" }} src={img} width={link.size[0]} height={link.size[1]} alt="" />
        </a>
    );
};
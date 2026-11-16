<script setup lang="ts">
// The ASTAROT manual's home page: the hero with the download button, a three-step quick start, the
// ten chapters (narrowed by the bar's search box), the five features of the subtitle, the guide's
// faces with the callout legend, and the system requirements with where to get help.
import { computed } from 'vue'
import { withBase } from 'vitepress'
import { RELEASES_URL, REPO_URL } from '../releases.mjs'
import ManualCallout from './ManualCallout.vue'
import ManualDownload from './ManualDownload.vue'
import ManualShell from './ManualShell.vue'
import { CALLOUTS, CHAPTERS, FACES, FEATURES } from './content.mjs'
import { locale, words } from './locale'
import { matchChapters, query } from './search'

const shown = computed(() => matchChapters(query.value, locale.value))
const numberOf = (slug: string) => CHAPTERS.findIndex((chapter) => chapter.slug === slug) + 1
const chapterTitle = (slug: string) => CHAPTERS.find((chapter) => chapter.slug === slug)?.title[locale.value] ?? ''
const chapterLink = (slug: string) => withBase(`/manual/${slug}`)
const guideLink = (path: string) => withBase(`/${locale.value}${path}`)
const pad = (n: number) => String(n).padStart(2, '0')

const SUPPORT = computed(() => {
  const links = words.value.support.links
  return [
    { ...links.help, href: chapterLink('help') },
    { ...links.issues, href: `${REPO_URL}/issues` },
    { ...links.releases, href: RELEASES_URL },
    { ...links.privacy, href: guideLink('/guide/privacy') },
  ]
})
</script>

<template>
  <ManualShell home>
    <!-- Hero -->
    <section class="hero" aria-labelledby="hero-title">
      <div class="a-container hero-inner">
        <div class="hero-text">
          <p class="label">{{ words.hero.label }}</p>
          <h1 id="hero-title" class="logo">
            <img class="app-icon" :src="withBase('/manual/brand/app-icon.svg')" alt="" width="88" height="88" />
            <picture>
              <source :srcset="withBase('/manual/brand/wordmark-dark.webp')" media="(prefers-color-scheme: dark)" />
              <img
                class="wordmark"
                :src="withBase('/manual/brand/wordmark-light.webp')"
                alt="ASTAROT — Speech, Translation, Accessibility, Revoicing & OCR Toolkit"
                width="955"
                height="248"
              />
            </picture>
          </h1>
          <div class="lead a-paragraphs">
            <p v-for="line in words.hero.lead" :key="line">{{ line }}</p>
          </div>
          <div class="cta">
            <ManualDownload />
            <a class="secondary" href="#quickstart">
              {{ words.hero.quickstart }}
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m0 0-5-5m5 5 5-5" /></svg>
            </a>
          </div>
          <p class="renamed">{{ words.hero.renamed }}</p>
        </div>
        <figure class="mascot">
          <div class="bubble a-paragraphs">
            <p v-for="line in words.hero.bubble" :key="line">{{ line }}</p>
          </div>
          <div class="mascot-stage">
            <img :src="withBase('/manual/mascot/mascot-hero.webp')" :alt="words.hero.mascotAlt" width="565" height="640" fetchpriority="high" />
          </div>
        </figure>
      </div>
    </section>

    <!-- Quick start -->
    <section id="quickstart" class="section" aria-labelledby="quickstart-title">
      <div class="a-container">
        <header class="section-head">
          <h2 id="quickstart-title" class="a-heading">{{ words.quickstart.title }}</h2>
          <p>{{ words.quickstart.intro }}</p>
        </header>
        <ol class="steps">
          <li v-for="(step, index) in words.quickstart.steps" :key="step.title" class="step">
            <span class="step-number" aria-hidden="true">{{ index + 1 }}</span>
            <h3 class="a-heading">{{ step.title }}</h3>
            <div class="a-paragraphs step-text">
              <p v-for="line in step.text" :key="line">{{ line }}</p>
            </div>
            <a class="more" :href="chapterLink(step.chapter)">
              {{ words.quickstart.open }}
              <span class="visually-hidden">: {{ chapterTitle(step.chapter) }}</span>
              <span aria-hidden="true">→</span>
            </a>
          </li>
        </ol>
      </div>
    </section>

    <!-- Contents -->
    <section id="contents" class="section" aria-labelledby="contents-title">
      <div class="a-container">
        <header class="section-head">
          <h2 id="contents-title" class="a-heading">{{ words.contents.title }}</h2>
          <p>{{ words.contents.intro }}</p>
        </header>
        <div class="count-row">
          <p class="count" role="status">{{ words.contents.count(shown.length, CHAPTERS.length) }}</p>
          <button v-if="query" type="button" class="clear" @click="query = ''">{{ words.contents.clear }}</button>
        </div>
        <ol id="contents-list" class="toc">
          <li v-for="chapter in shown" :key="chapter.slug">
            <a class="toc-item" :href="chapterLink(chapter.slug)">
              <span class="toc-number" aria-hidden="true">{{ pad(numberOf(chapter.slug)) }}</span>
              <span class="toc-body">
                <span class="visually-hidden">{{ words.contents.chapter(numberOf(chapter.slug)) }} </span>
                <span class="toc-title">{{ chapter.title[locale] }}</span>
                <span class="toc-summary">{{ chapter.summary[locale] }}</span>
              </span>
              <span class="chip" :class="chapter.status">{{ words.contents.status[chapter.status] }}</span>
            </a>
          </li>
        </ol>
        <p v-if="!shown.length" class="empty">{{ words.contents.empty }}</p>
      </div>
    </section>

    <!-- Features -->
    <section id="features" class="section" aria-labelledby="features-title">
      <div class="a-container">
        <header class="section-head">
          <h2 id="features-title" class="a-heading">{{ words.features.title }}</h2>
          <p>{{ words.features.intro }}</p>
        </header>
        <ul class="features">
          <li v-for="feature in FEATURES" :key="feature.id" class="feature">
            <svg class="feature-icon" viewBox="0 0 24 24" aria-hidden="true">
              <template v-if="feature.id === 'speech'">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
              </template>
              <path v-else-if="feature.id === 'translation'" d="M4 6h9M8.5 4v2c0 4-2.2 7-5 8.5M6 10c1.2 2 3.2 3.6 5.5 4.5M13 20l4-9 4 9M14.5 17h5" />
              <template v-else-if="feature.id === 'accessibility'">
                <circle cx="12" cy="4.5" r="1.8" />
                <path d="M5 8.5c2.3.7 4.6 1 7 1s4.7-.3 7-1M12 9.5V14m0 0-3 6.5M12 14l3 6.5" />
              </template>
              <path v-else-if="feature.id === 'revoicing'" d="M3 12h1.5M7 8.5v7M11 5v14M15 8v8M19 10.5v3" />
              <path
                v-else
                d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M8 10h8M8 14h5"
              />
            </svg>
            <h3 class="a-heading">
              <span class="feature-word" lang="en">{{ feature.word }}</span>
              <span v-if="locale === 'ja'" class="feature-name">{{ words.features.items[feature.id].name }}</span>
            </h3>
            <div class="a-paragraphs feature-text">
              <p v-for="line in words.features.items[feature.id].text" :key="line">{{ line }}</p>
            </div>
            <ul class="feature-links">
              <li v-for="slug in feature.chapters" :key="slug">
                <a :href="chapterLink(slug)">
                  {{ words.contents.chapter(numberOf(slug)) }} {{ chapterTitle(slug) }}
                </a>
              </li>
            </ul>
          </li>
        </ul>
      </div>
    </section>

    <!-- The guide and the callouts -->
    <section id="guide" class="section" aria-labelledby="guide-title">
      <div class="a-container">
        <header class="section-head">
          <h2 id="guide-title" class="a-heading">{{ words.guide.title }}</h2>
          <div class="a-paragraphs">
            <p v-for="line in words.guide.intro" :key="line">{{ line }}</p>
          </div>
        </header>
        <ul class="faces">
          <li v-for="face in FACES" :key="face" class="face">
            <img
              :src="withBase(`/manual/mascot/face-${face}.webp`)"
              :alt="words.guide.faceAlt(words.guide.faces[face].name)"
              width="256"
              height="256"
              loading="lazy"
            />
            <p class="face-name">{{ words.guide.faces[face].name }}</p>
            <p class="face-use">{{ words.guide.faces[face].use }}</p>
          </li>
        </ul>

        <h3 class="a-heading sub-title">{{ words.guide.legendTitle }}</h3>
        <p class="sub-intro">{{ words.guide.legendIntro }}</p>
        <div class="legend">
          <ManualCallout v-for="entry in CALLOUTS" :key="entry.kind" :kind="entry.kind">
            {{ words.guide.callouts[entry.kind].text }}
          </ManualCallout>
        </div>
      </div>
    </section>

    <!-- Requirements and support -->
    <section id="system" class="section" aria-labelledby="system-title">
      <div class="a-container two-up">
        <div>
          <header class="section-head">
            <h2 id="system-title" class="a-heading">{{ words.system.title }}</h2>
            <div class="a-paragraphs">
              <p v-for="line in words.system.intro" :key="line">{{ line }}</p>
            </div>
          </header>
          <dl class="os-list">
            <div v-for="row in words.system.rows" :key="row.os" class="os">
              <dt class="a-heading">{{ row.os }}</dt>
              <dd class="a-paragraphs">
                <p v-for="line in row.text" :key="line">{{ line }}</p>
              </dd>
            </div>
          </dl>
          <div class="gpu a-paragraphs">
            <p v-for="line in words.system.gpu" :key="line">{{ line }}</p>
          </div>
          <a class="more" :href="guideLink('/guide/requirements')">{{ words.system.details }} <span aria-hidden="true">→</span></a>
        </div>
        <div id="support">
          <header class="section-head">
            <h2 class="a-heading">{{ words.support.title }}</h2>
            <p>{{ words.support.intro }}</p>
          </header>
          <ul class="support">
            <li v-for="link in SUPPORT" :key="link.href">
              <a class="support-item" :href="link.href">
                <span class="support-name">{{ link.name }}</span>
                <span class="support-text">{{ link.text }}</span>
              </a>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </ManualShell>
</template>

<style scoped>
/* ---------- Hero ---------- */
.hero {
  padding-block: clamp(40px, 7vw, 88px) clamp(32px, 5vw, 56px);
  background:
    radial-gradient(60% 80% at 85% 30%, var(--a-backdrop) 0%, transparent 70%),
    var(--a-bg);
}

.hero-inner {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
  align-items: center;
  gap: clamp(24px, 5vw, 64px);
}

.label {
  display: inline-block;
  margin-bottom: 20px;
  padding: 2px 12px;
  border: 1px solid var(--a-border-strong);
  border-radius: 999px;
  font-size: 14px;
  color: var(--a-text-2);
}

.logo {
  display: flex;
  align-items: center;
  gap: clamp(14px, 2.4vw, 24px);
}

.app-icon {
  flex-shrink: 0;
  width: clamp(64px, 9vw, 96px);
  height: auto;
  border-radius: 22%;
  box-shadow: 0 10px 28px color-mix(in srgb, var(--a-plum) 30%, transparent);
}

.wordmark {
  display: block;
  width: min(460px, 100%);
  height: auto;
}

picture {
  min-width: 0;
  flex: 1;
}

.lead {
  max-width: 34em;
  margin-top: 28px;
  font-size: clamp(17px, 1.9vw, 19px);
  line-height: 1.85;
  color: var(--a-text-2);
}

.cta {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px 16px;
  margin-top: 32px;
}

.secondary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 52px;
  padding: 0 20px;
  border: 1px solid var(--a-border-strong);
  border-radius: 12px;
  background: var(--a-surface);
  color: var(--a-text);
  font-size: 17px;
  font-weight: 700;
  text-decoration: none;
  transition: background-color var(--a-fast) var(--a-ease), border-color var(--a-fast) var(--a-ease);
}

.secondary:hover {
  border-color: var(--a-lilac);
  background: var(--a-bg-soft);
}

.secondary svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.renamed {
  margin-top: 20px;
  font-size: 14px;
  color: var(--a-text-3);
}

.mascot {
  position: relative;
  display: grid;
  justify-items: center;
}

.mascot-stage {
  width: min(360px, 100%);
}

.mascot-stage img {
  display: block;
  width: 100%;
  height: auto;
  filter: drop-shadow(0 18px 30px color-mix(in srgb, var(--a-plum) 22%, transparent));
}

.bubble {
  position: relative;
  justify-self: start;
  max-width: 300px;
  margin-bottom: 18px;
  padding: 14px 18px;
  border: 2px solid var(--a-plum);
  border-radius: 18px;
  background: var(--a-offwhite);
  color: var(--a-plum);
  font-size: 15px;
  line-height: 1.7;
  box-shadow: 4px 4px 0 var(--a-lilac);
}

/* The bubble's tail, pointing down at the guide. */
.bubble::after {
  content: '';
  position: absolute;
  left: 56%;
  bottom: -12px;
  width: 20px;
  height: 20px;
  border-right: 2px solid var(--a-plum);
  border-bottom: 2px solid var(--a-plum);
  background: var(--a-offwhite);
  transform: rotate(45deg) skew(8deg, 8deg);
}

/* ---------- Sections ---------- */
.section {
  padding-top: clamp(56px, 8vw, 96px);
  scroll-margin-top: 72px;
}

.section-head {
  max-width: 40em;
  margin-bottom: 28px;
}

.section-head h2 {
  font-size: clamp(26px, 3.4vw, 34px);
}

.section-head > p,
.section-head > .a-paragraphs {
  margin-top: 10px;
  color: var(--a-text-2);
}

.more {
  display: inline-flex;
  gap: 6px;
  margin-top: 16px;
  font-weight: 600;
  text-decoration: none;
}

.more:hover {
  text-decoration: underline;
}

/* ---------- Quick start ---------- */
.steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  counter-reset: none;
}

.step {
  display: flex;
  flex-direction: column;
  padding: 24px;
  border: 1px solid var(--a-border);
  border-radius: var(--a-radius);
  background: var(--a-surface);
}

.step-number {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  margin-bottom: 16px;
  border-radius: 50%;
  background: var(--a-mark-bg);
  color: var(--a-mark-text);
  font-family: Outfit, system-ui, sans-serif;
  font-size: 19px;
  font-weight: 700;
}

.step h3 {
  font-size: 19px;
}

.step-text {
  margin-top: 8px;
  color: var(--a-text-2);
}

.step .more {
  margin-top: auto;
  padding-top: 16px;
}

/* ---------- Contents ---------- */
.count-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.count {
  font-size: 14px;
  font-weight: 600;
  color: var(--a-text-2);
  font-variant-numeric: tabular-nums;
}

.clear {
  padding: 2px 10px;
  border: 1px solid var(--a-border-strong);
  border-radius: 999px;
  background: transparent;
  color: var(--a-link);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.toc {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.toc-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 16px;
  height: 100%;
  padding: 18px 20px;
  border: 1px solid var(--a-border);
  border-radius: var(--a-radius);
  background: var(--a-surface);
  color: var(--a-text);
  text-decoration: none;
  transition: border-color var(--a-fast) var(--a-ease), background-color var(--a-fast) var(--a-ease);
}

.toc-item:hover {
  border-color: var(--a-lilac);
  background: var(--a-bg-soft);
}

.toc-number {
  font-family: Outfit, system-ui, sans-serif;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--a-link);
  font-variant-numeric: tabular-nums;
}

.toc-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toc-title {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.5;
}

.toc-summary {
  font-size: 14px;
  line-height: 1.65;
  color: var(--a-text-2);
}

.chip {
  padding: 1px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
  white-space: nowrap;
}

.chip.guide {
  background: var(--a-accent-soft);
  color: var(--a-link);
}

.chip.pending {
  border: 1px dashed var(--a-border-strong);
  color: var(--a-text-3);
}

.empty {
  padding: 24px;
  border: 1px dashed var(--a-border-strong);
  border-radius: var(--a-radius);
  color: var(--a-text-2);
}

/* ---------- Features ---------- */
.features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.feature {
  display: flex;
  flex-direction: column;
  padding: 22px;
  border: 1px solid var(--a-border);
  border-radius: var(--a-radius);
  background: var(--a-surface);
}

.feature-icon {
  width: 40px;
  height: 40px;
  padding: 8px;
  border-radius: 10px;
  background: var(--a-accent-soft);
  fill: none;
  stroke: var(--a-link);
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.feature h3 {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  margin-top: 14px;
}

.feature-word {
  font-size: 19px;
}

.feature-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--a-text-3);
}

.feature-text {
  margin-top: 8px;
  font-size: 15px;
  line-height: 1.7;
  color: var(--a-text-2);
}

.feature-links {
  margin-top: auto;
  padding-top: 14px;
  font-size: 14px;
}

.feature-links a {
  text-decoration: none;
}

.feature-links a:hover {
  text-decoration: underline;
}

/* ---------- Guide ---------- */
.faces {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.face {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 12px 18px;
  border: 1px solid var(--a-border);
  border-radius: var(--a-radius);
  background: var(--a-surface);
  text-align: center;
}

.face img {
  width: min(112px, 100%);
  height: auto;
  border-radius: 50%;
  background: var(--a-backdrop);
}

.face-name {
  margin-top: 10px;
  font-weight: 700;
}

.face-use {
  margin-top: 2px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--a-text-2);
}

.sub-title {
  margin-top: 48px;
  font-size: 21px;
}

.sub-intro {
  margin-top: 6px;
  margin-bottom: 18px;
  color: var(--a-text-2);
}

.legend {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

/* ---------- Requirements and support ---------- */
.two-up {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: clamp(32px, 5vw, 64px);
}

.os-list {
  display: grid;
  gap: 12px;
}

.os {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 12px;
  padding: 16px 18px;
  border: 1px solid var(--a-border);
  border-radius: var(--a-radius);
  background: var(--a-surface);
}

.os dt {
  font-size: 16px;
}

.os dd {
  font-size: 15px;
  line-height: 1.7;
  color: var(--a-text-2);
}

.gpu {
  margin-top: 18px;
  font-size: 15px;
  color: var(--a-text-2);
}

.support {
  display: grid;
  gap: 10px;
}

.support-item {
  display: flex;
  flex-direction: column;
  padding: 14px 18px;
  border: 1px solid var(--a-border);
  border-radius: var(--a-radius);
  background: var(--a-surface);
  text-decoration: none;
  transition: border-color var(--a-fast) var(--a-ease);
}

.support-item:hover {
  border-color: var(--a-lilac);
}

.support-name {
  font-weight: 700;
  color: var(--a-link);
}

.support-text {
  font-size: 14px;
  color: var(--a-text-2);
}

/* ---------- Narrow windows ---------- */
@media (max-width: 900px) {
  .steps {
    grid-template-columns: minmax(0, 1fr);
  }
  .two-up {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 760px) {
  .hero-inner {
    grid-template-columns: minmax(0, 1fr);
  }
  .mascot {
    grid-row: 1;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: end;
    gap: 12px;
  }
  .mascot-stage {
    grid-column: 1;
    grid-row: 1;
    width: 120px;
  }
  .bubble {
    grid-column: 2;
    grid-row: 1;
    margin-bottom: 40px;
    font-size: 14px;
  }
  .bubble::after {
    left: -12px;
    bottom: 18px;
    transform: rotate(135deg) skew(8deg, 8deg);
  }
  .toc,
  .legend {
    grid-template-columns: minmax(0, 1fr);
  }
  .faces {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 420px) {
  .toc-item {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .chip {
    grid-column: 2;
    justify-self: start;
  }
  .os {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
}
</style>

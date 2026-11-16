<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'
import { VPButton } from 'vitepress/theme-without-fonts'
import DownloadButton from './components/DownloadButton.vue'

// The hero's buttons, from the front matter `heroActions` (not `hero.actions`, which the default
// hero draws by itself). An entry with `download: true` is the download button; its `link` is the
// install page, which the button's menu points to.
interface Action {
  theme?: 'brand' | 'alt'
  text?: string
  link: string
  download?: boolean
}

const { frontmatter } = useData()
const actions = computed(() => (frontmatter.value.heroActions as Action[] | undefined) ?? [])
</script>

<template>
  <div v-if="actions.length" class="home-actions">
    <template v-for="action in actions" :key="action.link">
      <DownloadButton v-if="action.download" :install="action.link" />
      <div v-else class="action">
        <VPButton tag="a" size="medium" :theme="action.theme" :text="action.text ?? ''" :href="action.link" />
      </div>
    </template>
  </div>
</template>

<style scoped>
/* The same row as the default hero's actions. */
.home-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  margin: -6px;
  padding-top: 24px;
}

@media (min-width: 640px) {
  .home-actions {
    padding-top: 32px;
  }
}

.action {
  flex-shrink: 0;
  padding: 6px;
}
</style>

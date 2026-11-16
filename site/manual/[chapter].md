---
# One page per chapter of theme/manual/content.ts ([chapter].paths.ts). A chapter's own text,
# once written, goes inside <ManualChapter>.
layout: false
search: false
---

<script setup>
import { useData } from 'vitepress'
import ManualChapter from '../.vitepress/theme/manual/ManualChapter.vue'

const { params } = useData()
</script>

<ManualChapter :slug="params.chapter" />

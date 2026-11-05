<script setup lang="ts">
import { computed } from 'vue'
import { Bookmark } from 'lucide-vue-next'
import type { Notice, Source } from '../types/notice.ts'
import { highlight, shortDate } from '../utils/format.ts'

const props = defineProps<{
  notice: Notice
  source: Source
  isRead: boolean
  isBookmarked: boolean
  tokens: string[]
  /** 单个学院页面中不再重复显示来源 */
  showSource: boolean
  /** 按月分组时在每条通知上显示日期 */
  showDate?: boolean
}>()

const emit = defineEmits<{
  open: []
  'toggle-bookmark': []
}>()

const NEW_WINDOW_MS = 24 * 3_600_000
const isNew = computed(
  () => !props.isRead && !!props.notice.firstSeenAt && Date.now() - Date.parse(props.notice.firstSeenAt) < NEW_WINDOW_MS,
)
const titleSegments = computed(() => highlight(props.notice.title, props.tokens))
const summarySegments = computed(() => highlight(props.notice.summary, props.tokens))
const logo = computed(() => import.meta.env.BASE_URL + props.source.logo)

function onLogoError(e: Event) {
  ;(e.target as HTMLImageElement).src = import.meta.env.BASE_URL + 'favicon.ico'
}
</script>

<template>
  <article class="group relative flex gap-3.5 px-5 py-4 transition-colors hover:bg-stone-50 dark:hover:bg-night-700/60">
    <img
      v-if="showSource"
      :src="logo"
      :alt="source.name"
      loading="lazy"
      decoding="async"
      width="32"
      height="32"
      class="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-white object-cover ring-1 ring-stone-200 dark:ring-night-600"
      @error="onLogoError"
    />

    <div class="min-w-0 flex-1">
      <div v-if="showSource || showDate || isNew" class="mb-1 flex items-center gap-2 text-xs">
        <span v-if="showSource" class="truncate text-stone-500 dark:text-stone-400">{{ source.name }}</span>
        <time v-if="showDate && notice.date" class="tabular-nums text-stone-400 dark:text-stone-500">{{ shortDate(notice.date) }}</time>
        <span
          v-if="isNew"
          class="rounded-full border border-ecnu-200 px-1.5 text-[10.5px] leading-[18px] text-ecnu-600 dark:border-ecnu-700 dark:text-ecnu-300"
          >新</span
        >
      </div>

      <a
        :href="notice.link"
        target="_blank"
        rel="noopener noreferrer"
        class="block text-[15px] font-medium leading-relaxed transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-ecnu-700 dark:group-hover:text-ecnu-200"
        :class="isRead ? 'text-stone-400 dark:text-stone-500' : 'text-stone-900 dark:text-stone-100'"
        @click="emit('open')"
        @auxclick="emit('open')"
      >
        <template v-for="(seg, i) in titleSegments" :key="i">
          <mark v-if="seg.hit" class="rounded-sm bg-gold-200/70 px-0.5 text-inherit dark:bg-gold-500/30">{{ seg.text }}</mark>
          <template v-else>{{ seg.text }}</template>
        </template>
      </a>

      <p v-if="notice.summary" class="mt-1 line-clamp-2 text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">
        <template v-for="(seg, i) in summarySegments" :key="i">
          <mark v-if="seg.hit" class="rounded-sm bg-gold-200/70 px-0.5 text-inherit dark:bg-gold-500/30">{{ seg.text }}</mark>
          <template v-else>{{ seg.text }}</template>
        </template>
      </p>
    </div>

    <button
      type="button"
      class="relative z-10 -mr-1.5 h-fit shrink-0 rounded-md p-1.5 transition hover:bg-stone-200/60 dark:hover:bg-night-600"
      :class="isBookmarked ? 'text-ecnu-600 dark:text-ecnu-300' : 'text-stone-300 lg:opacity-0 lg:group-hover:opacity-100 dark:text-stone-600'"
      :aria-label="isBookmarked ? '取消收藏' : '收藏'"
      :title="isBookmarked ? '取消收藏' : '收藏'"
      @click="emit('toggle-bookmark')"
    >
      <Bookmark class="h-[18px] w-[18px]" :stroke-width="1.75" :class="isBookmarked ? 'fill-current' : ''" />
    </button>
  </article>
</template>

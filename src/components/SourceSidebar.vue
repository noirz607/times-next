<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, Bookmark, Newspaper, Star } from 'lucide-vue-next'
import type { Source } from '../types/notice.ts'
import { CATEGORIES } from '../data/categories.ts'

const props = defineProps<{
  sources: Source[]
  counts: Record<string, number>
  /** 已关注的来源 ID，按关注顺序排列 */
  followed: string[]
  failed: Map<string, string>
  /** 当前导航：all | following | bookmarks | source:<id> */
  nav: string
  totals: { all: number; following: number; bookmarks: number }
}>()

const emit = defineEmits<{
  navigate: [nav: string]
  'toggle-follow': [id: string]
}>()

const base = import.meta.env.BASE_URL
const followedSet = computed(() => new Set(props.followed))

/** 已关注的来源置顶，其余按分类排列 */
const sections = computed(() => {
  const byId = new Map(props.sources.map((s) => [s.id, s]))
  const pinned = props.followed.map((id) => byId.get(id)).filter((s): s is Source => !!s)
  const groups = CATEGORIES.map((c) => ({
    id: c.id as string,
    label: c.label,
    sources: props.sources.filter((s) => s.category === c.id && !followedSet.value.has(s.id)),
  }))
  return [{ id: 'pinned', label: '置顶', sources: pinned }, ...groups].filter((g) => g.sources.length)
})

const views = computed(() => [
  { nav: 'all', label: '全部通知', icon: Newspaper, count: props.totals.all },
  { nav: 'following', label: '我的关注', icon: Star, count: props.totals.following },
  { nav: 'bookmarks', label: '收藏', icon: Bookmark, count: props.totals.bookmarks },
])

const row =
  'relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13.5px] transition-colors'
const idle = 'text-stone-600 hover:bg-stone-200/50 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-night-700 dark:hover:text-stone-100'
const active =
  'bg-white font-medium text-ecnu-700 shadow-[0_1px_2px_rgba(28,25,23,0.06)] ring-1 ring-stone-200/80 dark:bg-night-700 dark:text-ecnu-200 dark:ring-night-600'
</script>

<template>
  <nav class="space-y-6">
    <ul class="space-y-0.5">
      <li v-for="v in views" :key="v.nav">
        <button type="button" :class="[row, nav === v.nav ? active : idle]" @click="emit('navigate', v.nav)">
          <component :is="v.icon" class="h-4 w-4 shrink-0" :stroke-width="1.75" />
          <span class="flex-1">{{ v.label }}</span>
          <span class="text-xs tabular-nums text-stone-400 dark:text-stone-500">{{ v.count }}</span>
        </button>
      </li>
    </ul>

    <section v-for="g in sections" :key="g.id">
      <h3
        class="mb-1.5 flex items-center gap-1.5 px-2.5 text-[11px] font-medium tracking-[0.18em] text-stone-400 dark:text-stone-500"
      >
        <Star v-if="g.id === 'pinned'" class="h-3 w-3 fill-gold-400 text-gold-400" />
        {{ g.label }}
      </h3>
      <ul class="space-y-0.5">
        <li v-for="s in g.sources" :key="s.id" class="group relative">
          <button
            type="button"
            :class="[row, 'pr-9', nav === `source:${s.id}` ? active : idle]"
            @click="emit('navigate', `source:${s.id}`)"
          >
            <img
              :src="base + s.logo"
              alt=""
              loading="lazy"
              decoding="async"
              width="18"
              height="18"
              class="h-[18px] w-[18px] shrink-0 rounded-full bg-white object-cover ring-1 ring-stone-200 dark:ring-night-600"
            />
            <span class="truncate">{{ s.name }}</span>
            <span v-if="failed.has(s.id)" :title="`最近一次抓取失败：${failed.get(s.id)}`" class="shrink-0">
              <AlertTriangle class="h-3.5 w-3.5 text-gold-500" />
            </span>
            <span class="ml-auto pl-1 text-xs tabular-nums text-stone-400 dark:text-stone-500">{{ counts[s.id] ?? 0 }}</span>
          </button>
          <button
            type="button"
            class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 transition hover:bg-stone-200/70 dark:hover:bg-night-600"
            :aria-label="followedSet.has(s.id) ? `取消置顶${s.name}` : `关注并置顶${s.name}`"
            :title="followedSet.has(s.id) ? '取消置顶' : '关注并置顶'"
            @click="emit('toggle-follow', s.id)"
          >
            <Star
              class="h-3.5 w-3.5"
              :stroke-width="1.75"
              :class="
                followedSet.has(s.id)
                  ? 'fill-gold-400 text-gold-400'
                  : 'text-stone-300 lg:opacity-0 lg:group-hover:opacity-100 dark:text-stone-600'
              "
            />
          </button>
        </li>
      </ul>
    </section>
  </nav>
</template>

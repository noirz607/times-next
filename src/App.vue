<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ArrowUpRight, CheckCheck, Github, Inbox, Menu, Moon, RefreshCw, Search, Star, Sun, X } from 'lucide-vue-next'
import sourcesData from './data/sources.json'
import { CATEGORIES } from './data/categories.ts'
import type { Notice, Source } from './types/notice.ts'
import { useNotices } from './composables/useNotices.ts'
import { useStorage } from './composables/useStorage.ts'
import { dayKey, dayLabel, monthLabel, relativeTime } from './utils/format.ts'
import NoticeCard from './components/NoticeCard.vue'
import SourceSidebar from './components/SourceSidebar.vue'

const PAGE_SIZE = 30
const MAX_READ = 5000
const baseUrl = import.meta.env.BASE_URL

const sources = sourcesData as Source[]
const sourceMap = new Map(sources.map((s) => [s.id, s]))
const categoryLabel = new Map(CATEGORIES.map((c) => [c.id, c.label]))

const { data, loading, error, reload } = useNotices()

// ---------- 持久化的用户偏好 ----------
const followed = useStorage<string[]>('times:followed', [])
/** 收藏保存完整快照，这样即使通知已从 notices.json 中过期清理也不会丢失 */
const bookmarks = useStorage<Notice[]>('times:bookmarks', [])
const readLinks = useStorage<string[]>('times:read', [])
/** 当前导航：all | following | bookmarks | source:<id> */
const nav = useStorage<string>('times:nav', 'all')
const theme = useStorage<'light' | 'dark'>(
  'times:theme',
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
)

// 来源被删除后，清理失效的偏好
followed.value = followed.value.filter((id) => sourceMap.has(id))
if (nav.value.startsWith('source:') && !sourceMap.has(nav.value.slice(7))) nav.value = 'all'

const followedSet = computed(() => new Set(followed.value))
const bookmarkSet = computed(() => new Set(bookmarks.value.map((b) => b.link)))
const readSet = computed(() => new Set(readLinks.value))

// ---------- 临时状态 ----------
const query = ref('')
const unreadOnly = ref(false)
const visibleCount = ref(PAGE_SIZE)
const showDrawer = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)

const tokens = computed(() => query.value.trim().toLowerCase().split(/\s+/).filter(Boolean))
const failed = computed(
  () => new Map((data.value?.sources ?? []).filter((s) => !s.ok).map((s) => [s.id, s.error ?? '未知错误'])),
)
const notices = computed(() => (data.value?.notices ?? []).filter((n) => sourceMap.has(n.sourceId)))
const currentSource = computed(() => (nav.value.startsWith('source:') ? sourceMap.get(nav.value.slice(7)) : undefined))

function matchesQuery(n: Notice): boolean {
  if (!tokens.value.length) return true
  const haystack = `${n.title} ${n.summary} ${sourceMap.get(n.sourceId)?.name ?? ''}`.toLowerCase()
  return tokens.value.every((t) => haystack.includes(t))
}

/** 当前页面的通知 */
const navNotices = computed(() => {
  if (currentSource.value) return notices.value.filter((n) => n.sourceId === currentSource.value!.id)
  switch (nav.value) {
    case 'following':
      return notices.value.filter((n) => followedSet.value.has(n.sourceId))
    case 'bookmarks':
      return bookmarks.value
        .filter((n) => sourceMap.has(n.sourceId))
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    default:
      return notices.value
  }
})

const filtered = computed(() =>
  navNotices.value.filter((n) => (!unreadOnly.value || !readSet.value.has(n.link)) && matchesQuery(n)),
)
const unreadCount = computed(() => filtered.value.filter((n) => !readSet.value.has(n.link)).length)

/** 侧边栏数量（跟随搜索词变化） */
const counts = computed(() => {
  const result: Record<string, number> = {}
  for (const n of notices.value) if (matchesQuery(n)) result[n.sourceId] = (result[n.sourceId] ?? 0) + 1
  return result
})
const totals = computed(() => ({
  all: notices.value.filter(matchesQuery).length,
  following: followed.value.reduce((sum, id) => sum + (counts.value[id] ?? 0), 0),
  bookmarks: bookmarks.value.length,
}))

/** 汇总页按天分组；单个学院发文较稀疏，按月分组 */
const groups = computed(() => {
  const byMonth = !!currentSource.value
  const result: { key: string; label: string; items: Notice[] }[] = []
  for (const n of filtered.value.slice(0, visibleCount.value)) {
    const day = n.date ? dayKey(n.date) : ''
    const key = byMonth ? day.slice(0, 7) : day
    const last = result[result.length - 1]
    if (last && last.key === key) last.items.push(n)
    else result.push({ key, label: byMonth ? monthLabel(key) : dayLabel(key), items: [n] })
  }
  return result
})

/** 页面标题区 */
const heading = computed(() => {
  const s = currentSource.value
  if (s) return { eyebrow: categoryLabel.get(s.category) ?? '', title: s.name }
  switch (nav.value) {
    case 'following':
      return { eyebrow: 'Following', title: '我的关注' }
    case 'bookmarks':
      return { eyebrow: 'Bookmarks', title: '收藏' }
    default:
      return { eyebrow: 'All Notices', title: '全部通知' }
  }
})

watch([nav, query, unreadOnly], () => (visibleCount.value = PAGE_SIZE))
watch(nav, () => {
  showDrawer.value = false
  window.scrollTo({ top: 0 })
})
watch(theme, (t) => document.documentElement.classList.toggle('dark', t === 'dark'), { immediate: true })

// ---------- 操作 ----------
function markRead(link: string) {
  if (readSet.value.has(link)) return
  readLinks.value = [...readLinks.value, link].slice(-MAX_READ)
}

function markAllRead() {
  const toAdd = filtered.value.map((n) => n.link).filter((l) => !readSet.value.has(l))
  readLinks.value = [...readLinks.value, ...toAdd].slice(-MAX_READ)
}

function toggleBookmark(n: Notice) {
  bookmarks.value = bookmarkSet.value.has(n.link)
    ? bookmarks.value.filter((b) => b.link !== n.link)
    : [{ ...n }, ...bookmarks.value]
}

function toggleFollow(id: string) {
  followed.value = followedSet.value.has(id) ? followed.value.filter((f) => f !== id) : [...followed.value, id]
}

// 按 / 聚焦搜索框，Esc 清空或关闭抽屉
function onKeydown(e: KeyboardEvent) {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
  if (e.key === '/' && !typing) {
    e.preventDefault()
    searchInput.value?.focus()
  } else if (e.key === 'Escape') {
    if (showDrawer.value) showDrawer.value = false
    else if (typing) {
      query.value = ''
      searchInput.value?.blur()
    }
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

const sidebarProps = computed(() => ({
  sources,
  counts: counts.value,
  followed: followed.value,
  failed: failed.value,
  nav: nav.value,
  totals: totals.value,
}))

const iconBtn =
  'rounded-lg p-2 text-stone-500 transition hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-night-700 dark:hover:text-stone-100'
const pillBtn =
  'inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-[7px] text-[13px] text-stone-600 transition hover:border-stone-300 hover:text-stone-900 dark:border-night-600 dark:bg-night-800 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:text-stone-100'
</script>

<template>
  <div class="min-h-screen">
    <!-- 顶栏 -->
    <header class="sticky top-0 z-30 border-b border-stone-200/80 bg-paper/85 backdrop-blur-md dark:border-night-600 dark:bg-night/85">
      <div class="mx-auto flex h-16 max-w-6xl items-center gap-3 px-5">
        <button type="button" :class="[iconBtn, '-ml-2 lg:hidden']" aria-label="打开导航" @click="showDrawer = true">
          <Menu class="h-5 w-5" :stroke-width="1.75" />
        </button>
        <a href="./" class="flex items-center gap-3" @click.prevent="nav = 'all'">
          <img :src="baseUrl + 'favicon.ico'" alt="" class="h-8 w-8 rounded-full ring-1 ring-stone-200 dark:ring-night-600" />
          <div class="leading-none">
            <div class="font-serif text-[17px] font-semibold tracking-wide text-stone-900 dark:text-stone-50">旧闻缓递</div>
            <div class="mt-1 text-[10px] tracking-[0.25em] text-stone-400">ECNU TIMES</div>
          </div>
        </a>
        <p v-if="data" class="ml-4 hidden text-xs text-stone-400 sm:block">
          {{ relativeTime(data.updatedAt) }}更新
          <template v-if="failed.size"> · <span class="text-gold-500">{{ failed.size }} 个来源抓取失败</span></template>
        </p>
        <div class="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            :class="iconBtn"
            :aria-label="theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'"
            @click="theme = theme === 'dark' ? 'light' : 'dark'"
          >
            <Sun v-if="theme === 'dark'" class="h-[18px] w-[18px]" :stroke-width="1.75" />
            <Moon v-else class="h-[18px] w-[18px]" :stroke-width="1.75" />
          </button>
          <a href="https://github.com/ECNU-minus" target="_blank" rel="noopener noreferrer" :class="iconBtn" aria-label="GitHub">
            <Github class="h-[18px] w-[18px]" :stroke-width="1.75" />
          </a>
        </div>
      </div>
    </header>

    <div class="mx-auto grid max-w-6xl gap-10 px-5 py-8 lg:grid-cols-[248px_minmax(0,1fr)]">
      <!-- 桌面端导航 -->
      <aside class="hidden lg:block">
        <div class="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-6 pr-1 [scrollbar-width:thin]">
          <SourceSidebar v-bind="sidebarProps" @navigate="nav = $event" @toggle-follow="toggleFollow" />
        </div>
      </aside>

      <main class="min-w-0">
        <!-- 标题区 -->
        <div class="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-stone-200 pb-6 dark:border-night-600">
          <img
            v-if="currentSource"
            :src="baseUrl + currentSource.logo"
            alt=""
            width="56"
            height="56"
            decoding="async"
            class="h-14 w-14 rounded-full bg-white object-cover ring-1 ring-stone-200 dark:ring-night-600"
          />
          <div class="min-w-0">
            <p class="text-[11px] font-medium uppercase tracking-[0.22em] text-ecnu-600 dark:text-ecnu-300">{{ heading.eyebrow }}</p>
            <h1 class="mt-1.5 font-serif text-[28px] font-semibold leading-tight text-stone-900 dark:text-stone-50">
              {{ heading.title }}
            </h1>
          </div>
          <div v-if="currentSource" class="ml-auto flex items-center gap-2">
            <button
              type="button"
              :class="[pillBtn, followedSet.has(currentSource.id) && 'border-gold-300 bg-gold-100/60 text-stone-800 dark:border-gold-500/40 dark:bg-gold-500/10 dark:text-gold-200']"
              @click="toggleFollow(currentSource.id)"
            >
              <Star
                class="h-3.5 w-3.5"
                :stroke-width="1.75"
                :class="followedSet.has(currentSource.id) ? 'fill-gold-400 text-gold-400' : ''"
              />
              {{ followedSet.has(currentSource.id) ? '已置顶' : '关注并置顶' }}
            </button>
            <a :href="currentSource.homepage" target="_blank" rel="noopener noreferrer" :class="pillBtn">
              官网 <ArrowUpRight class="h-3.5 w-3.5" :stroke-width="1.75" />
            </a>
          </div>
        </div>

        <!-- 工具栏 -->
        <div class="mt-5 flex flex-wrap items-center gap-2">
          <label class="relative min-w-[220px] flex-1">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" :stroke-width="1.75" />
            <input
              ref="searchInput"
              v-model="query"
              type="search"
              :placeholder="currentSource ? `在${currentSource.name}中搜索` : '搜索标题、摘要或学院'"
              class="w-full rounded-lg border border-stone-200 bg-white py-[7px] pl-9 pr-14 text-[13.5px] outline-none transition placeholder:text-stone-400 focus:border-ecnu-300 focus:ring-4 focus:ring-ecnu-100 dark:border-night-600 dark:bg-night-800 dark:focus:border-ecnu-700 dark:focus:ring-ecnu-900/50"
            />
            <button
              v-if="query"
              type="button"
              class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-stone-400 hover:text-stone-700"
              aria-label="清空搜索"
              @click="query = ''"
            >
              <X class="h-4 w-4" />
            </button>
            <kbd
              v-else
              class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-stone-200 px-1.5 font-sans text-[11px] text-stone-400 dark:border-night-600"
              >/</kbd
            >
          </label>
          <label :class="[pillBtn, 'cursor-pointer select-none']">
            <input v-model="unreadOnly" type="checkbox" class="h-3.5 w-3.5 accent-ecnu-600" />
            只看未读
          </label>
          <button type="button" :class="[pillBtn, 'disabled:pointer-events-none disabled:opacity-40']" :disabled="!unreadCount" @click="markAllRead">
            <CheckCheck class="h-3.5 w-3.5" :stroke-width="1.75" />
            全部已读
          </button>
        </div>

        <p v-if="data" class="mt-3 text-xs text-stone-400">
          {{ filtered.length }} 条通知 · {{ unreadCount }} 条未读
        </p>

        <!-- 加载中 -->
        <div v-if="loading && !data" class="mt-8 space-y-3">
          <div v-for="i in 6" :key="i" class="h-[72px] animate-pulse rounded-xl bg-stone-200/50 dark:bg-night-800" />
        </div>

        <!-- 出错 -->
        <div v-else-if="error && !data" class="mt-16 text-center">
          <p class="text-stone-500">数据加载失败：{{ error }}</p>
          <button
            type="button"
            class="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-ecnu-600 px-4 py-2 text-sm text-white hover:bg-ecnu-700"
            @click="reload"
          >
            <RefreshCw class="h-4 w-4" /> 重试
          </button>
        </div>

        <!-- 空状态 -->
        <div v-else-if="!filtered.length" class="mt-20 flex flex-col items-center text-center text-stone-500 dark:text-stone-400">
          <Inbox class="h-9 w-9 text-stone-300 dark:text-stone-600" :stroke-width="1.5" />
          <template v-if="nav === 'following' && !followed.length">
            <p class="mt-4 font-serif text-lg text-stone-700 dark:text-stone-200">还没有关注任何学院</p>
            <p class="mt-1.5 text-sm">在左侧学院旁点击 ☆，它会被置顶，并汇总到这里</p>
            <button type="button" class="mt-4 text-sm text-ecnu-600 hover:underline lg:hidden" @click="showDrawer = true">选择学院</button>
          </template>
          <template v-else-if="nav === 'bookmarks' && !bookmarks.length">
            <p class="mt-4 font-serif text-lg text-stone-700 dark:text-stone-200">收藏夹是空的</p>
            <p class="mt-1.5 text-sm">点击通知右侧的书签图标，稍后在这里查看</p>
          </template>
          <template v-else>
            <p class="mt-4 font-serif text-lg text-stone-700 dark:text-stone-200">没有符合条件的通知</p>
            <button
              v-if="query || unreadOnly"
              type="button"
              class="mt-3 text-sm text-ecnu-600 hover:underline dark:text-ecnu-300"
              @click="(query = ''), (unreadOnly = false)"
            >
              清除搜索条件
            </button>
          </template>
        </div>

        <!-- 列表 -->
        <template v-else>
          <section v-for="g in groups" :key="g.key" class="mt-8">
            <h2
              class="sticky top-16 z-10 -mx-1 mb-3 flex items-center gap-3 bg-paper px-1 py-1.5 dark:bg-night"
            >
              <span class="font-serif text-[15px] font-semibold text-stone-800 dark:text-stone-100">{{ g.label }}</span>
              <span class="h-px flex-1 bg-stone-200 dark:bg-night-600" />
              <span class="text-xs tabular-nums text-stone-400">{{ g.items.length }}</span>
            </h2>
            <div
              class="divide-y divide-stone-100 overflow-hidden rounded-xl bg-white ring-1 ring-stone-200/80 dark:divide-night-600 dark:bg-night-800 dark:ring-night-600"
            >
              <NoticeCard
                v-for="n in g.items"
                :key="n.link"
                :notice="n"
                :source="sourceMap.get(n.sourceId)!"
                :is-read="readSet.has(n.link)"
                :is-bookmarked="bookmarkSet.has(n.link)"
                :tokens="tokens"
                :show-source="!currentSource"
                :show-date="!!currentSource"
                @open="markRead(n.link)"
                @toggle-bookmark="toggleBookmark(n)"
              />
            </div>
          </section>

          <button
            v-if="visibleCount < filtered.length"
            type="button"
            :class="[pillBtn, 'mx-auto mt-8 flex px-6']"
            @click="visibleCount += PAGE_SIZE"
          >
            加载更多 · 还有 {{ filtered.length - visibleCount }} 条
          </button>
        </template>

        <footer class="mt-16 border-t border-stone-200 pt-6 text-center text-xs leading-relaxed text-stone-400 dark:border-night-600">
          数据由 <a href="https://github.com/DIYgod/RSSHub" target="_blank" rel="noopener noreferrer" class="underline-offset-2 hover:text-stone-600 hover:underline">RSSHub</a>
          每 4 小时抓取自各学院官网 ·
          <a href="https://github.com/ECNU-minus" target="_blank" rel="noopener noreferrer" class="underline-offset-2 hover:text-stone-600 hover:underline">ECNU-minus</a>
        </footer>
      </main>
    </div>

    <!-- 移动端导航抽屉 -->
    <Transition
      enter-active-class="transition duration-200"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-150"
      leave-to-class="opacity-0"
    >
      <div v-if="showDrawer" class="fixed inset-0 z-40 bg-stone-900/30 backdrop-blur-[2px] lg:hidden" @click.self="showDrawer = false">
        <div class="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-paper shadow-2xl dark:bg-night-800">
          <div class="flex h-16 items-center justify-between border-b border-stone-200 px-5 dark:border-night-600">
            <span class="font-serif text-[17px] font-semibold">旧闻缓递</span>
            <button type="button" :class="[iconBtn, '-mr-2']" aria-label="关闭" @click="showDrawer = false">
              <X class="h-5 w-5" :stroke-width="1.75" />
            </button>
          </div>
          <div class="flex-1 overflow-y-auto p-3">
            <SourceSidebar v-bind="sidebarProps" @navigate="nav = $event" @toggle-follow="toggleFollow" />
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Bell, Check, Clock, Loader2, Mail, ShieldCheck, Sparkles, Trash2, X } from 'lucide-vue-next'
import { CATEGORIES } from '../data/categories.ts'
import type { PushFrequency, Source } from '../types/notice.ts'
import { useStorage } from '../composables/useStorage.ts'

const props = defineProps<{
  open: boolean
  sources: Source[]
  followed: string[]
}>()

const emit = defineEmits<{
  close: []
}>()

const API_BASE = (import.meta.env.VITE_SUBSCRIPTION_API_URL || 'https://times-api.myecnu.org').replace(/\/+$/, '')

interface SavedSubPrefs {
  email: string
  frequency: PushFrequency
  sources: string[]
  keywordsText: string
  subscribedAt?: string
}

const savedPrefs = useStorage<SavedSubPrefs>('times:sub-prefs', {
  email: '',
  frequency: 'instant',
  sources: [],
  keywordsText: '',
})

const mode = ref<'subscribe' | 'unsubscribe'>('subscribe')
const email = ref(savedPrefs.value.email)
const frequency = ref<PushFrequency>(savedPrefs.value.frequency || 'instant')
const selectedSources = ref<string[]>([...savedPrefs.value.sources])
const keywordsText = ref(savedPrefs.value.keywordsText || '')

const code = ref('')
const verificationToken = ref('')
const countdown = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

const sendingCode = ref(false)
const submitting = ref(false)
const feedback = ref<{ type: 'ok' | 'err'; text: string } | null>(null)

// 首次打开且尚未选择过订阅源时，默认同步「我的关注」或常用教务源
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    feedback.value = null
    if (selectedSources.value.length === 0) {
      selectedSources.value = props.followed.length > 0 ? [...props.followed] : ['bksy', 'cxcy', 'contest']
    }
  },
  { immediate: true },
)

const selectedSet = computed(() => new Set(selectedSources.value))

const groupedSources = computed(() =>
  CATEGORIES.map((cat) => ({
    ...cat,
    items: props.sources.filter((s) => s.category === cat.id),
  })),
)

function toggleSource(id: string) {
  if (selectedSet.value.has(id)) {
    selectedSources.value = selectedSources.value.filter((x) => x !== id)
  } else {
    selectedSources.value = [...selectedSources.value, id]
  }
}

function syncFromFollowed() {
  if (props.followed.length > 0) {
    selectedSources.value = [...props.followed]
  }
}

function selectAll() {
  selectedSources.value = props.sources.map((s) => s.id)
}

function clearAll() {
  selectedSources.value = []
}

function isValidEmail(addr: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr.trim())
}

function startCountdown(sec = 60) {
  countdown.value = sec
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }, 1000)
}

async function handleSendCode() {
  feedback.value = null
  const cleanEmail = email.value.trim().toLowerCase()
  if (!isValidEmail(cleanEmail)) {
    feedback.value = { type: 'err', text: '请输入格式正确的邮箱地址' }
    return
  }
  sendingCode.value = true
  try {
    const res = await fetch(`${API_BASE}/api/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `请求失败 (HTTP ${res.status})`)
    }
    verificationToken.value = data.token
    startCountdown(60)
    feedback.value = { type: 'ok', text: `验证码已发送至 ${cleanEmail}，请查收邮件（含垃圾箱）` }
  } catch (e) {
    feedback.value = {
      type: 'err',
      text: e instanceof Error ? e.message : '发送验证码失败，请稍后重试',
    }
  } finally {
    sendingCode.value = false
  }
}

async function handleSubmit() {
  feedback.value = null
  const cleanEmail = email.value.trim().toLowerCase()
  if (!isValidEmail(cleanEmail)) {
    feedback.value = { type: 'err', text: '请输入有效的邮箱地址' }
    return
  }
  if (!code.value.trim() || !verificationToken.value) {
    feedback.value = { type: 'err', text: '请先点击「获取验证码」并输入收到的 6 位验证码' }
    return
  }

  if (mode.value === 'subscribe' && selectedSources.value.length === 0) {
    feedback.value = { type: 'err', text: '请至少勾选 1 个要订阅的通知来源' }
    return
  }

  const keywords = keywordsText.value
    .split(/[,，\s]+/)
    .map((k) => k.trim())
    .filter(Boolean)

  submitting.value = true
  try {
    const endpoint = mode.value === 'subscribe' ? '/api/subscribe' : '/api/unsubscribe'
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: cleanEmail,
        code: code.value.trim(),
        token: verificationToken.value,
        sources: selectedSources.value,
        frequency: frequency.value,
        keywords,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `提交失败 (HTTP ${res.status})`)
    }

    if (mode.value === 'subscribe') {
      savedPrefs.value = {
        email: cleanEmail,
        frequency: frequency.value,
        sources: [...selectedSources.value],
        keywordsText: keywordsText.value.trim(),
        subscribedAt: new Date().toISOString(),
      }
      feedback.value = {
        type: 'ok',
        text: `订阅成功！已为您订阅 ${selectedSources.value.length} 个院系/部门通知，确认邮件已发送。`,
      }
    } else {
      savedPrefs.value = {
        ...savedPrefs.value,
        subscribedAt: undefined,
      }
      feedback.value = { type: 'ok', text: `已成功退订 ${cleanEmail} 的所有邮件通知。` }
    }
    code.value = ''
    verificationToken.value = ''
  } catch (e) {
    feedback.value = {
      type: 'err',
      text: e instanceof Error ? e.message : '操作失败，请稍后重试',
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0"
    leave-active-class="transition duration-150 ease-in"
    leave-to-class="opacity-0"
  >
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-[2px]"
      @click.self="emit('close')"
    >
      <div
        class="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-stone-200 bg-paper shadow-2xl dark:border-night-600 dark:bg-night-800"
      >
        <!-- 弹窗顶栏 -->
        <div class="flex items-center justify-between border-b border-stone-200/80 px-6 py-4 dark:border-night-600">
          <div class="flex items-center gap-2.5">
            <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-ecnu-600/10 text-ecnu-600 dark:bg-ecnu-300/10 dark:text-ecnu-300">
              <Mail class="h-4 w-4" :stroke-width="2" />
            </div>
            <div>
              <h2 class="font-serif text-[17px] font-semibold text-stone-900 dark:text-stone-50">校内通知邮件订阅</h2>
              <p class="text-[11px] text-stone-400">免账号注册 · 按院系定向推送 · 随时一键退订</p>
            </div>
          </div>
          <button
            type="button"
            class="rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-200/60 hover:text-stone-700 dark:hover:bg-night-700 dark:hover:text-stone-200"
            aria-label="关闭"
            @click="emit('close')"
          >
            <X class="h-5 w-5" />
          </button>
        </div>

        <!-- 模式切换 -->
        <div class="flex border-b border-stone-200/80 bg-stone-100/70 px-6 pt-2.5 dark:border-night-600 dark:bg-night/50">
          <button
            type="button"
            class="border-b-2 px-4 pb-2.5 text-[13px] font-medium transition"
            :class="
              mode === 'subscribe'
                ? 'border-ecnu-600 text-ecnu-600 dark:border-ecnu-300 dark:text-ecnu-300'
                : 'border-transparent text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
            "
            @click="(mode = 'subscribe'), (feedback = null)"
          >
            新增 / 更新订阅
          </button>
          <button
            type="button"
            class="border-b-2 px-4 pb-2.5 text-[13px] font-medium transition"
            :class="
              mode === 'unsubscribe'
                ? 'border-ecnu-600 text-ecnu-600 dark:border-ecnu-300 dark:text-ecnu-300'
                : 'border-transparent text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
            "
            @click="(mode = 'unsubscribe'), (feedback = null)"
          >
            取消订阅
          </button>
          <span
            v-if="savedPrefs.subscribedAt && mode === 'subscribe'"
            class="ml-auto inline-flex items-center gap-1 pb-2 text-[11px] text-emerald-700 dark:text-emerald-400"
          >
            <ShieldCheck class="h-3.5 w-3.5" /> 已保存本地订阅记录
          </span>
        </div>

        <!-- 内容区 -->
        <div class="flex-1 space-y-5 overflow-y-auto px-6 py-5 [scrollbar-width:thin]">
          <!-- 1. 邮箱与验证码 -->
          <div class="space-y-3">
            <label class="block text-xs font-medium text-stone-700 dark:text-stone-300">
              1. 接收邮箱（支持华师校园邮箱 <code class="rounded bg-stone-200/70 px-1 py-0.5 text-[11px] dark:bg-night-700">@stu.ecnu.edu.cn</code>、QQ、163 等）
            </label>
            <div class="flex flex-col gap-2 sm:flex-row">
              <input
                v-model="email"
                type="email"
                placeholder="yourname@stu.ecnu.edu.cn"
                class="flex-1 rounded-lg border border-stone-200 bg-white px-3.5 py-2 text-[13.5px] outline-none transition placeholder:text-stone-400 focus:border-ecnu-400 focus:ring-4 focus:ring-ecnu-100 dark:focus:ring-ecnu-900/50 dark:border-night-600 dark:bg-night dark:focus:border-ecnu-700"
              />
              <button
                type="button"
                :disabled="sendingCode || countdown > 0 || !email.trim()"
                class="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-stone-200 bg-white px-4 py-2 text-[13px] font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 disabled:pointer-events-none disabled:opacity-50 dark:border-night-600 dark:bg-night-700 dark:text-stone-200"
                @click="handleSendCode"
              >
                <Loader2 v-if="sendingCode" class="h-3.5 w-3.5 animate-spin" />
                <span>{{ countdown > 0 ? `${countdown}s 后可重发` : '获取邮箱验证码' }}</span>
              </button>
            </div>
            <div class="flex items-center gap-2">
              <input
                v-model="code"
                type="text"
                inputmode="numeric"
                maxlength="6"
                placeholder="输入邮件收到的 6 位数字验证码"
                class="w-full rounded-lg border border-stone-200 bg-white px-3.5 py-2 text-[13.5px] tracking-widest outline-none transition placeholder:tracking-normal placeholder:text-stone-400 focus:border-ecnu-400 focus:ring-4 focus:ring-ecnu-100 dark:focus:ring-ecnu-900/50 sm:max-w-xs dark:border-night-600 dark:bg-night dark:focus:border-ecnu-700"
              />
              <span class="text-[11px] text-stone-400">验证码 10 分钟内有效</span>
            </div>
          </div>

          <template v-if="mode === 'subscribe'">
            <!-- 2. 推送频率 -->
            <div class="space-y-2.5">
              <label class="block text-xs font-medium text-stone-700 dark:text-stone-300">2. 选择推送方式</label>
              <div class="grid gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  class="flex items-start gap-3 rounded-xl border p-3.5 text-left transition"
                  :class="
                    frequency === 'instant'
                      ? 'border-ecnu-600 bg-ecnu-600/[0.04] ring-1 ring-ecnu-600 dark:border-ecnu-400 dark:bg-ecnu-400/10 dark:ring-ecnu-400'
                      : 'border-stone-200 bg-white hover:border-stone-300 dark:border-night-600 dark:bg-night'
                  "
                  @click="frequency = 'instant'"
                >
                  <Bell
                    class="mt-0.5 h-4 w-4 shrink-0"
                    :class="frequency === 'instant' ? 'text-ecnu-600 dark:text-ecnu-300' : 'text-stone-400'"
                  />
                  <div>
                    <div class="text-[13px] font-medium text-stone-900 dark:text-stone-100">每 4 小时增量推送（推荐）</div>
                    <p class="mt-0.5 text-[11.5px] leading-relaxed text-stone-500 dark:text-stone-400">
                      每次抓取发现所选院系有新通知时立即发信，无新增绝不打扰
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  class="flex items-start gap-3 rounded-xl border p-3.5 text-left transition"
                  :class="
                    frequency === 'daily'
                      ? 'border-ecnu-600 bg-ecnu-600/[0.04] ring-1 ring-ecnu-600 dark:border-ecnu-400 dark:bg-ecnu-400/10 dark:ring-ecnu-400'
                      : 'border-stone-200 bg-white hover:border-stone-300 dark:border-night-600 dark:bg-night'
                  "
                  @click="frequency = 'daily'"
                >
                  <Clock
                    class="mt-0.5 h-4 w-4 shrink-0"
                    :class="frequency === 'daily' ? 'text-ecnu-600 dark:text-ecnu-300' : 'text-stone-400'"
                  />
                  <div>
                    <div class="text-[13px] font-medium text-stone-900 dark:text-stone-100">每日汇总日报（20:00）</div>
                    <p class="mt-0.5 text-[11.5px] leading-relaxed text-stone-500 dark:text-stone-400">
                      每天晚 8 点汇总过去 24 小时所选院系的新通知合并发一封
                    </p>
                  </div>
                </button>
              </div>
            </div>

            <!-- 3. 订阅院系选择 -->
            <div class="space-y-2.5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <label class="text-xs font-medium text-stone-700 dark:text-stone-300">
                  3. 选择要订阅的院系 / 部门（已选
                  <span class="font-semibold text-ecnu-600 dark:text-ecnu-300">{{ selectedSources.length }}</span>
                  / {{ sources.length }}）
                </label>
                <div class="flex items-center gap-2 text-xs">
                  <button
                    v-if="followed.length"
                    type="button"
                    class="inline-flex items-center gap-1 text-ecnu-600 hover:underline dark:text-ecnu-300"
                    @click="syncFromFollowed"
                  >
                    <Sparkles class="h-3 w-3" /> 同步「我的关注」({{ followed.length }})
                  </button>
                  <span v-if="followed.length" class="text-stone-300 dark:text-night-600">|</span>
                  <button type="button" class="text-stone-500 hover:text-stone-800 dark:hover:text-stone-200" @click="selectAll">
                    全选
                  </button>
                  <span class="text-stone-300 dark:text-night-600">|</span>
                  <button type="button" class="text-stone-500 hover:text-stone-800 dark:hover:text-stone-200" @click="clearAll">
                    清空
                  </button>
                </div>
              </div>

              <div class="max-h-56 space-y-3 overflow-y-auto rounded-xl border border-stone-200 bg-white p-3.5 dark:border-night-600 dark:bg-night">
                <div v-for="group in groupedSources" :key="group.id">
                  <div class="mb-1.5 text-[11px] font-medium text-stone-400">{{ group.label }}</div>
                  <div class="flex flex-wrap gap-1.5">
                    <button
                      v-for="s in group.items"
                      :key="s.id"
                      type="button"
                      class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] transition"
                      :class="
                        selectedSet.has(s.id)
                          ? 'border-ecnu-600/80 bg-ecnu-600 text-white dark:border-ecnu-400 dark:bg-ecnu-600'
                          : 'border-stone-200 bg-stone-50/70 text-stone-600 hover:border-stone-300 hover:text-stone-900 dark:border-night-600 dark:bg-night-800 dark:text-stone-300'
                      "
                      @click="toggleSource(s.id)"
                    >
                      <Check v-if="selectedSet.has(s.id)" class="h-3 w-3 stroke-[2.5]" />
                      <span>{{ s.name }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 4. 关键词过滤（可选） -->
            <div class="space-y-1.5">
              <label class="block text-xs font-medium text-stone-700 dark:text-stone-300">
                4. 关键词过滤（选填，多个词用空格分隔；留空则接收所选学院全部新通知）
              </label>
              <input
                v-model="keywordsText"
                type="text"
                placeholder="例如：奖学金 选课 保研 竞赛 讲座（留空代表不过滤）"
                class="w-full rounded-lg border border-stone-200 bg-white px-3.5 py-2 text-[13px] outline-none transition placeholder:text-stone-400 focus:border-ecnu-400 focus:ring-4 focus:ring-ecnu-100 dark:focus:ring-ecnu-900/50 dark:border-night-600 dark:bg-night dark:focus:border-ecnu-700"
              />
            </div>
          </template>

          <template v-else>
            <div class="rounded-xl border border-stone-200 bg-white p-4 text-[13px] leading-relaxed text-stone-600 dark:border-night-600 dark:bg-night dark:text-stone-300">
              <p>您可以通过以下两种方式随时取消订阅：</p>
              <ul class="mt-2 list-disc space-y-1 pl-5 text-xs text-stone-500 dark:text-stone-400">
                <li>直接点击任何一封推送邮件底部的<strong>「一键退订」</strong>链接（无需输入验证码）。</li>
                <li>或在上方输入您的订阅邮箱并获取验证码，点击下方「确认退订」按钮。</li>
              </ul>
            </div>
          </template>

          <!-- 提示反馈 -->
          <div
            v-if="feedback"
            class="rounded-xl px-4 py-2.5 text-[13px]"
            :class="
              feedback.type === 'ok'
                ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50'
                : 'bg-rose-50 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-800/50'
            "
          >
            {{ feedback.text }}
          </div>
        </div>

        <!-- 底部操作栏 -->
        <div class="flex items-center justify-between border-t border-stone-200/80 bg-stone-100/50 px-6 py-3.5 dark:border-night-600 dark:bg-night/50">
          <span class="text-[11px] text-stone-400">
            如修改已订阅的学院或频率，使用同一邮箱重新保存即可覆盖
          </span>
          <div class="flex items-center gap-2.5">
            <button
              type="button"
              class="rounded-lg px-3.5 py-2 text-[13px] text-stone-500 transition hover:bg-stone-200/60 hover:text-stone-800 dark:hover:bg-night-700 dark:hover:text-stone-200"
              @click="emit('close')"
            >
              关闭
            </button>
            <button
              type="button"
              :disabled="submitting"
              class="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium text-white shadow-sm transition disabled:pointer-events-none disabled:opacity-50"
              :class="mode === 'subscribe' ? 'bg-ecnu-600 hover:bg-ecnu-700' : 'bg-rose-600 hover:bg-rose-700'"
              @click="handleSubmit"
            >
              <Loader2 v-if="submitting" class="h-4 w-4 animate-spin" />
              <Trash2 v-else-if="mode === 'unsubscribe'" class="h-3.5 w-3.5" />
              <Check v-else class="h-3.5 w-3.5" />
              <span>{{ mode === 'subscribe' ? '确认保存订阅' : '确认退订' }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

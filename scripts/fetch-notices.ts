/**
 * 抓取脚本：请求 RSSHub 上每个来源的路由，把 RSS XML 转成 public/notices.json。
 *
 * 用法：
 *   RSSHUB_URL=http://localhost:1200 node scripts/fetch-notices.ts
 *
 * 环境变量：
 *   RSSHUB_URL    RSSHub 地址，默认 http://localhost:1200
 *   PREVIOUS_URL  上一次部署的 notices.json 地址。用于累积历史通知，
 *                 并在某个来源抓取失败时保留它之前的数据。未设置时回退到本地 public/notices.json
 *   OUTPUT_PATH   输出路径，默认 public/notices.json
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { XMLParser } from 'fast-xml-parser'
import type { Notice, NoticesFile, Source, SourceStatus } from '../src/types/notice.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RSSHUB_URL = (process.env.RSSHUB_URL ?? 'http://localhost:1200').replace(/\/+$/, '')
const PREVIOUS_URL = process.env.PREVIOUS_URL
const OUTPUT_PATH = resolve(ROOT, process.env.OUTPUT_PATH ?? 'public/notices.json')
const SOURCES_PATH = resolve(ROOT, 'src/data/sources.json')

const CONCURRENCY = 6
const TIMEOUT_MS = 60_000
const RETRIES = 2
/** 超过这个天数的历史通知会被清理 */
const MAX_AGE_DAYS = 180
const MAX_NOTICES = 2000
/** 发布日期早于这个天数的通知不会被标记为「新」（与 NoticeCard.vue 中的 NEW_MAX_AGE_MS 保持一致） */
const NEW_MAX_AGE_DAYS = 7
const SUMMARY_LENGTH = 160

const parser = new XMLParser({
  ignoreAttributes: true,
  processEntities: {
    enabled: true,
    maxTotalExpansions: 200_000,
    maxExpandedLength: 10_000_000,
  } as unknown as boolean,
  htmlEntities: true,
  isArray: (name) => name === 'item',
})

// ---------- 工具函数 ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function text(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') return String((value as Record<string, unknown>)['#text'] ?? '').trim()
  return String(value).trim()
}

function toPlainText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

function parseDate(raw: string): string | null {
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.cause instanceof Error ? `${e.message}: ${e.cause.message}` : e.message
  return String(e)
}

/** 简单的并发池 */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

// ---------- 抓取与解析 ----------

function parseFeed(xml: string, source: Source): Notice[] {
  const doc = parser.parse(xml)
  const channel = doc?.rss?.channel
  if (!channel) throw new Error('响应不是合法的 RSS 文档')

  const notices: Notice[] = []
  for (const item of channel.item ?? []) {
    const link = text(item.link)
    if (!link) continue
    const plain = toPlainText(text(item.description))
    // 部分源站标题为空（旧版里会出现空白卡片），用正文开头兜底
    const title = toPlainText(text(item.title)) || truncate(plain, 60)
    if (!title) continue
    notices.push({
      link,
      sourceId: source.id,
      title,
      date: parseDate(text(item.pubDate)),
      summary: plain === title ? '' : truncate(plain, SUMMARY_LENGTH),
    })
  }
  return notices
}

async function fetchSource(source: Source): Promise<Notice[]> {
  const url = RSSHUB_URL + source.route
  let lastError: unknown
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return parseFeed(await res.text(), source)
    } catch (e) {
      lastError = e
      if (attempt < RETRIES) await sleep(2000 * (attempt + 1))
    }
  }
  throw lastError
}

async function loadPrevious(): Promise<Notice[]> {
  if (PREVIOUS_URL) {
    try {
      const res = await fetch(PREVIOUS_URL, { signal: AbortSignal.timeout(20_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as NoticesFile
      console.log(`↩️  已从 ${PREVIOUS_URL} 读取 ${data.notices?.length ?? 0} 条历史通知`)
      return data.notices ?? []
    } catch (e) {
      console.warn(`⚠️  读取 PREVIOUS_URL 失败（${errorMessage(e)}），尝试本地文件`)
    }
  }
  if (existsSync(OUTPUT_PATH)) {
    try {
      const data = JSON.parse(await readFile(OUTPUT_PATH, 'utf8')) as NoticesFile
      console.log(`↩️  已从本地读取 ${data.notices?.length ?? 0} 条历史通知`)
      return data.notices ?? []
    } catch {
      /* 文件损坏则忽略 */
    }
  }
  return []
}

// ---------- 主流程 ----------

async function main() {
  const sources = JSON.parse(await readFile(SOURCES_PATH, 'utf8')) as Source[]
  console.log(`📡 RSSHub: ${RSSHUB_URL}，共 ${sources.length} 个来源`)

  const [previous, results] = await Promise.all([
    loadPrevious(),
    mapPool(sources, CONCURRENCY, async (source) => {
      try {
        return { source, notices: await fetchSource(source) }
      } catch (e) {
        return { source, notices: [] as Notice[], error: errorMessage(e) }
      }
    }),
  ])

  const statuses: SourceStatus[] = results.map(({ source, notices, error }) => {
    console.log(error ? `  ❌ ${source.name}: ${error}` : `  ✅ ${source.name}: ${notices.length} 条`)
    return { id: source.id, ok: !error, count: notices.length, ...(error ? { error } : {}) }
  })

  const okCount = statuses.filter((s) => s.ok).length
  if (okCount === 0) {
    // 全部失败通常意味着 RSSHub 没起来，直接失败，避免部署出空数据
    console.error('💥 所有来源都抓取失败，终止')
    process.exit(1)
  }

  // 合并：先放入历史数据，再用本次抓取结果覆盖
  const now = new Date().toISOString()
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000
  const knownIds = new Set(sources.map((s) => s.id))
  const merged = new Map<string, Notice>()

  for (const n of previous) {
    if (!knownIds.has(n.sourceId)) continue
    const time = Date.parse(n.date ?? n.firstSeenAt ?? '')
    if (Number.isNaN(time) || time < cutoff) continue
    merged.set(n.link, n)
  }
  const isFirstRun = previous.length === 0
  // 未经裁剪的历史索引：超过 MAX_AGE_DAYS 被裁掉的旧通知若仍出现在 RSS 里，
  // 也不能因为“查不到”而在每次运行时被重新标记为新通知
  const previousByLink = new Map(previous.map((n) => [n.link, n]))
  const staleBefore = Date.now() - NEW_MAX_AGE_DAYS * 86_400_000
  for (const { notices } of results) {
    for (const n of notices) {
      const old = merged.get(n.link) ?? previousByLink.get(n.link)
      // 发布日期很早的通知（如来源恢复后补抓到的旧闻）不算新通知，也不应触发邮件推送
      const published = Date.parse(n.date ?? '')
      const isStale = !Number.isNaN(published) && published < staleBefore
      // 首次运行时没有历史可比对，不标记 firstSeenAt，否则所有通知都会显示为「新」
      const firstSeenAt = isStale ? undefined : (old?.firstSeenAt ?? (old || isFirstRun ? undefined : now))
      merged.set(n.link, firstSeenAt ? { ...n, firstSeenAt } : n)
    }
  }

  const notices = [...merged.values()]
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.firstSeenAt ?? '').localeCompare(a.firstSeenAt ?? ''))
    .slice(0, MAX_NOTICES)

  const output: NoticesFile = { updatedAt: now, sources: statuses, notices }
  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8')

  const added = notices.filter((n) => n.firstSeenAt === now).length
  console.log(`📦 成功 ${okCount}/${sources.length} 个来源，共 ${notices.length} 条通知（新增 ${added} 条）→ ${OUTPUT_PATH}`)
}

await main()

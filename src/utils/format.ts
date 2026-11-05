const TZ = 'Asia/Shanghai'
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** 返回北京时间的 YYYY-MM-DD */
export function dayKey(iso: string | Date): string {
  return dayFormatter.format(typeof iso === 'string' ? new Date(iso) : iso)
}

export function dayLabel(key: string): string {
  if (!key) return '日期未知'
  const now = new Date()
  if (key === dayKey(now)) return '今天'
  if (key === dayKey(new Date(now.getTime() - 86_400_000))) return '昨天'
  const [y, m, d] = key.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  const sameYear = y === Number(dayKey(now).slice(0, 4))
  return `${sameYear ? '' : `${y}年`}${m}月${d}日 · 周${weekday}`
}

/** key 为 YYYY-MM */
export function monthLabel(key: string): string {
  if (!key) return '日期未知'
  const [y, m] = key.split('-').map(Number)
  if (key === dayKey(new Date()).slice(0, 7)) return '本月'
  return y === Number(dayKey(new Date()).slice(0, 4)) ? `${m}月` : `${y}年${m}月`
}

export function shortDate(iso: string): string {
  const [, m, d] = dayKey(iso).split('-').map(Number)
  return `${m}月${d}日`
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.round(min / 60)
  if (hour < 24) return `${hour} 小时前`
  return `${Math.round(hour / 24)} 天前`
}

export interface Segment {
  text: string
  hit: boolean
}

/** 把文本按搜索词切分，用于安全地高亮（不使用 v-html） */
export function highlight(text: string, tokens: string[]): Segment[] {
  if (!tokens.length || !text) return [{ text, hit: false }]
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  const lower = new Set(tokens.map((t) => t.toLowerCase()))
  return text
    .split(re)
    .filter(Boolean)
    .map((part) => ({ text: part, hit: lower.has(part.toLowerCase()) }))
}

/**
 * 邮件推送脚本：在 fetch-notices.ts 运行完毕后执行，
 * 从 Cloudflare Worker 拉取订阅者列表，并通过 Resend Batch API 推送新增通知或每日汇总。
 *
 * 环境变量：
 *   SUBSCRIPTION_API_URL  Cloudflare Worker 地址（如 https://times-api.myecnu.org）
 *   SECRET_KEY            与 Worker 一致的鉴权密钥
 *   RESEND_API_KEY        Resend API Key
 *   RESEND_FROM           发件人（默认 "华师旧闻缓递 <notify@myecnu.org>"）
 *   SITE_URL              主站地址（默认 "https://times.myecnu.org"）
 *   FORCE_DAILY_DIGEST    设为 "true" 时强制触发每日汇总（用于手动测试）
 */
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Notice, NoticesFile, Source, Subscriber } from '../src/types/notice.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NOTICES_PATH = resolve(ROOT, process.env.OUTPUT_PATH ?? 'public/notices.json')
const SOURCES_PATH = resolve(ROOT, 'src/data/sources.json')

const SUBSCRIPTION_API_URL = (process.env.SUBSCRIPTION_API_URL ?? '').replace(/\/+$/, '')
const SECRET_KEY = process.env.SECRET_KEY ?? ''
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? ''
const RESEND_FROM = process.env.RESEND_FROM || '华师旧闻缓递 <notify@myecnu.org>'
const SITE_URL = (process.env.SITE_URL || 'https://times.myecnu.org').replace(/\/+$/, '')
const FORCE_DAILY = process.env.FORCE_DAILY_DIGEST === 'true'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getShanghaiHour(date = new Date()): number {
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: 'numeric',
    hour12: false,
  }).format(date)
  return Number(hourStr) % 24
}

function formatDateLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function renderEmail(
  sub: Subscriber,
  matched: Notice[],
  sourceMap: Map<string, Source>,
): { subject: string; html: string; text: string } {
  const isDaily = sub.frequency === 'daily'
  const firstTitle = matched[0]?.title ?? '校内新通知'
  const subject = isDaily
    ? `【华师旧闻缓递·日报】今日共 ${matched.length} 条新通知（${firstTitle.slice(0, 18)}等）`
    : matched.length === 1
      ? `【${sourceMap.get(matched[0].sourceId)?.name ?? '旧闻缓递'}】${firstTitle}`
      : `【华师旧闻缓递】${firstTitle.slice(0, 20)} 等 ${matched.length} 条新通知`

  // 按院系分组
  const bySource = new Map<string, Notice[]>()
  for (const n of matched) {
    const list = bySource.get(n.sourceId) ?? []
    list.push(n)
    bySource.set(n.sourceId, list)
  }

  const textLines: string[] = [
    `华东师大·旧闻缓递 (${SITE_URL})`,
    isDaily ? `今日为您汇总 ${matched.length} 条所关注院系的新通知：` : `发现 ${matched.length} 条您所关注院系的新通知：`,
    '',
  ]

  let groupsHtml = ''
  for (const [sourceId, items] of bySource) {
    const sourceName = sourceMap.get(sourceId)?.name ?? sourceId
    textLines.push(`【${sourceName}】`)
    let itemsHtml = ''
    for (const item of items) {
      const dateStr = formatDateLabel(item.date)
      textLines.push(`- ${item.title}${dateStr ? ` (${dateStr})` : ''}`)
      textLines.push(`  ${item.link}`)
      if (item.summary) textLines.push(`  摘要：${item.summary}`)

      itemsHtml += `
        <div style="padding:12px 0;border-bottom:1px solid #f5f5f4;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
            <a href="${escapeHtml(item.link)}" target="_blank" style="font-size:15px;font-weight:600;color:#1c1917;text-decoration:none;line-height:1.5;">
              ${escapeHtml(item.title)}
            </a>
            ${dateStr ? `<span style="font-size:12px;color:#a8a29e;white-space:nowrap;margin-left:8px;">${escapeHtml(dateStr)}</span>` : ''}
          </div>
          ${
            item.summary
              ? `<p style="margin:6px 0 0;font-size:13px;color:#57534e;line-height:1.6;">${escapeHtml(item.summary)}</p>`
              : ''
          }
        </div>
      `
    }
    textLines.push('')

    groupsHtml += `
      <div style="margin-bottom:20px;">
        <div style="font-size:12px;font-weight:700;color:#7a2c38;letter-spacing:0.05em;padding-bottom:6px;border-bottom:2px solid #7a2c38;">
          ${escapeHtml(sourceName)}（${items.length}）
        </div>
        ${itemsHtml}
      </div>
    `
  }

  if (sub.unsubUrl) {
    textLines.push(`---`, `修改订阅：${SITE_URL}/?subscribe=1`, `一键退订：${sub.unsubUrl}`)
  }

  const html = `
    <div style="background:#f6f4ef;padding:28px 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c1917;">
      <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e7e5e4;border-radius:14px;padding:28px;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:16px;border-bottom:1px solid #e7e5e4;margin-bottom:20px;">
          <div>
            <div style="font-size:11px;letter-spacing:0.22em;color:#7a2c38;font-weight:600;">ECNU TIMES</div>
            <div style="font-size:20px;font-weight:700;color:#1c1917;margin-top:2px;">华东师大·旧闻缓递</div>
          </div>
          <span style="font-size:12px;color:#78716c;background:#f5f5f4;padding:4px 10px;border-radius:999px;">
            ${isDaily ? '每日汇总日报' : '新增通知速递'} · ${matched.length} 条
          </span>
        </div>

        ${groupsHtml}

        <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e7e5e4;font-size:12px;color:#78716c;line-height:1.7;text-align:center;">
          <div>
            <a href="${SITE_URL}" style="color:#7a2c38;text-decoration:underline;">前往旧闻缓递网页版</a>
            &nbsp;·&nbsp;
            <a href="${SITE_URL}/?subscribe=1" style="color:#7a2c38;text-decoration:underline;">修改订阅院系/频率</a>
            ${
              sub.unsubUrl
                ? `&nbsp;·&nbsp;<a href="${escapeHtml(sub.unsubUrl)}" style="color:#78716c;text-decoration:underline;">一键取消订阅</a>`
                : ''
            }
          </div>
        </div>
      </div>
    </div>
  `

  return { subject, html, text: textLines.join('\n') }
}

async function main() {
  if (!SUBSCRIPTION_API_URL || !SECRET_KEY || !RESEND_API_KEY) {
    console.log('ℹ️  未配置邮件推送环境变量 (SUBSCRIPTION_API_URL / SECRET_KEY / RESEND_API_KEY)，跳过邮件推送')
    return
  }

  const [noticesRaw, sourcesRaw] = await Promise.all([
    readFile(NOTICES_PATH, 'utf8'),
    readFile(SOURCES_PATH, 'utf8'),
  ])
  const data = JSON.parse(noticesRaw) as NoticesFile
  const sources = JSON.parse(sourcesRaw) as Source[]
  const sourceMap = new Map(sources.map((s) => [s.id, s]))

  // 1. 本次抓取新增的通知（供 instant 订阅者使用）
  const instantNotices = data.notices.filter((n) => n.firstSeenAt === data.updatedAt)

  // 2. 过去 24 小时新增的通知（供 daily 订阅者在北京时间 20:00 档次使用）
  const shanghaiHour = getShanghaiHour()
  const isDailyWindow = FORCE_DAILY || (shanghaiHour >= 19 && shanghaiHour <= 22)
  const dayAgo = Date.parse(data.updatedAt) - 24 * 3600_000
  const dailyNotices = isDailyWindow
    ? data.notices.filter((n) => n.firstSeenAt && Date.parse(n.firstSeenAt) >= dayAgo)
    : []

  console.log(
    `📬 邮件检查：本次新增 ${instantNotices.length} 条；当前北京时间 ${shanghaiHour}:00（日报窗口：${isDailyWindow ? `开启，24h 内新增 ${dailyNotices.length} 条` : '非日报时段'}）`,
  )

  if (instantNotices.length === 0 && dailyNotices.length === 0) {
    console.log('📭 无待推送通知，结束')
    return
  }

  // 拉取订阅者列表
  const subRes = await fetch(`${SUBSCRIPTION_API_URL}/api/subscribers`, {
    headers: { Authorization: `Bearer ${SECRET_KEY}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!subRes.ok) {
    throw new Error(`拉取订阅者列表失败: HTTP ${subRes.status}`)
  }
  const { subscribers = [] } = (await subRes.json()) as { subscribers: Subscriber[] }
  console.log(`👥 共读取到 ${subscribers.length} 位订阅用户`)
  if (subscribers.length === 0) return

  // 构建待发送队列
  const emailsToSend: Array<{
    from: string
    to: string[]
    subject: string
    html: string
    text: string
    headers?: Record<string, string>
  }> = []

  for (const sub of subscribers) {
    const pool = sub.frequency === 'daily' ? dailyNotices : instantNotices
    if (pool.length === 0) continue

    const sourceSet = new Set(sub.sources)
    const keywords = (sub.keywords ?? []).map((k) => k.toLowerCase()).filter(Boolean)

    const matched = pool.filter((n) => {
      if (!sourceSet.has(n.sourceId)) return false
      if (keywords.length === 0) return true
      const hay = `${n.title} ${n.summary}`.toLowerCase()
      return keywords.some((kw) => hay.includes(kw))
    })

    if (matched.length === 0) continue

    const { subject, html, text } = renderEmail(sub, matched, sourceMap)
    emailsToSend.push({
      from: RESEND_FROM,
      to: [sub.email],
      subject,
      html,
      text,
      ...(sub.unsubUrl ? { headers: { 'List-Unsubscribe': `<${sub.unsubUrl}>` } } : {}),
    })
  }

  console.log(`✉️  准备向 ${emailsToSend.length} 位匹配用户发送通知邮件`)
  if (emailsToSend.length === 0) return

  // Resend Batch API 单次最多发送 100 封
  const BATCH_SIZE = 100
  let sentCount = 0
  for (let i = 0; i < emailsToSend.length; i += BATCH_SIZE) {
    const batch = emailsToSend.slice(i, i + BATCH_SIZE)
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      console.error(`❌ 批次发送失败 (HTTP ${res.status}): ${await res.text()}`)
    } else {
      sentCount += batch.length
    }
  }

  console.log(`✅ 邮件推送完成：成功提交 ${sentCount}/${emailsToSend.length} 封邮件`)
}

await main()

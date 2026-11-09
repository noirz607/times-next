/**
 * 华东师大·旧闻缓递 (ECNU Times) — 邮件订阅 Cloudflare Worker
 *
 * 绑定的资源与环境变量：
 * - KV Namespace: SUBSCRIBERS
 * - Secret: RESEND_API_KEY   (Resend 邮件 API Key，以 re_ 开头)
 * - Secret: SECRET_KEY       (随机密钥，用于签名验证码、一键退订链接及 GitHub Actions 拉取鉴权)
 * - Var:    RESEND_FROM      (发件人，例如 "华师旧闻缓递 <notify@myecnu.org>")
 * - Var:    SITE_URL         (主站地址，默认 "https://times.myecnu.org")
 */

const INDEX_KEY = 'subscribers:index'
const CODE_TTL_MS = 10 * 60 * 1000 // 验证码 10 分钟有效

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders,
    },
  })
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...corsHeaders,
    },
  })
}

async function hmacSign(secret, message) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.length <= 120
}

async function loadIndex(env) {
  const raw = await env.SUBSCRIBERS.get(INDEX_KEY)
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function saveIndex(env, indexObj) {
  await env.SUBSCRIBERS.put(INDEX_KEY, JSON.stringify(indexObj))
}

async function sendResendEmail(env, { to, subject, html, text }) {
  const from = env.RESEND_FROM || '华师旧闻缓递 <onboarding@resend.dev>'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      text,
    }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`邮件服务返回错误 (${res.status}): ${errText}`)
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    if (!env.SECRET_KEY || !env.RESEND_API_KEY || !env.SUBSCRIBERS) {
      return jsonResponse({ ok: false, error: '服务端未完成环境变量或 KV 绑定配置' }, 500)
    }

    const url = new URL(request.url)
    const path = url.pathname
    const siteUrl = (env.SITE_URL || 'https://times.myecnu.org').replace(/\/+$/, '')

    try {
      // 1. 发送 6 位邮箱验证码
      if (path === '/api/send-code' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}))
        const email = String(body.email || '').trim().toLowerCase()
        if (!isValidEmail(email)) {
          return jsonResponse({ ok: false, error: '邮箱地址格式不正确' }, 400)
        }

        const num = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000
        const code = String(num).padStart(6, '0')
        const expiresAt = Date.now() + CODE_TTL_MS
        const sig = await hmacSign(env.SECRET_KEY, `code:${email}:${code}:${expiresAt}`)
        const token = `${expiresAt}.${sig}`

        await sendResendEmail(env, {
          to: email,
          subject: `【华师旧闻缓递】邮箱验证码：${code}`,
          text: `您的华师旧闻缓递（ECNU Times）邮箱验证码为：${code}，10 分钟内有效。如非本人操作请忽略本邮件。`,
          html: `
            <div style="background:#f6f4ef;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c1917;">
              <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e7e5e4;border-radius:12px;padding:28px;">
                <div style="font-size:11px;letter-spacing:0.2em;color:#7a2c38;font-weight:600;">ECNU TIMES · 华师旧闻缓递</div>
                <h2 style="margin:8px 0 16px;font-size:20px;color:#1c1917;">验证您的订阅邮箱</h2>
                <p style="font-size:14px;color:#57534e;line-height:1.6;margin:0 0 16px;">请在网页订阅窗口中输入以下 6 位数字验证码（10 分钟内有效）：</p>
                <div style="background:#f5f5f4;border-radius:8px;padding:16px;text-align:center;font-size:28px;font-weight:700;letter-spacing:0.25em;color:#7a2c38;">
                  ${code}
                </div>
                <p style="font-size:12px;color:#a8a29e;margin:20px 0 0;">如非您本人操作，请直接忽略此邮件。</p>
              </div>
            </div>
          `,
        })

        return jsonResponse({ ok: true, expiresAt, token })
      }

      // 2. 确认保存订阅
      if (path === '/api/subscribe' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}))
        const email = String(body.email || '').trim().toLowerCase()
        const code = String(body.code || '').trim()
        const token = String(body.token || '').trim()
        const frequency = body.frequency === 'daily' ? 'daily' : 'instant'
        const sources = Array.isArray(body.sources)
          ? body.sources.map((s) => String(s).trim()).filter(Boolean).slice(0, 50)
          : []
        const keywords = Array.isArray(body.keywords)
          ? body.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 20)
          : []

        if (!isValidEmail(email)) {
          return jsonResponse({ ok: false, error: '邮箱格式不正确' }, 400)
        }
        if (sources.length === 0) {
          return jsonResponse({ ok: false, error: '请至少选择一个要订阅的院系或部门' }, 400)
        }

        const [expStr, sig] = token.split('.')
        const expiresAt = Number(expStr)
        if (!expiresAt || !sig || Date.now() > expiresAt) {
          return jsonResponse({ ok: false, error: '验证码已过期，请重新获取' }, 400)
        }
        const expectedSig = await hmacSign(env.SECRET_KEY, `code:${email}:${code}:${expiresAt}`)
        if (sig !== expectedSig) {
          return jsonResponse({ ok: false, error: '验证码不正确，请核对后重试' }, 400)
        }

        const now = new Date().toISOString()
        const index = await loadIndex(env)
        const prev = index[email]
        index[email] = {
          email,
          sources,
          frequency,
          keywords,
          createdAt: prev?.createdAt || now,
          updatedAt: now,
        }
        await saveIndex(env, index)

        const unsubToken = await hmacSign(env.SECRET_KEY, `unsub:${email}`)
        const unsubUrl = `${url.origin}/api/unsubscribe?email=${encodeURIComponent(email)}&token=${unsubToken}`
        const freqLabel = frequency === 'daily' ? '每日汇总日报（每天 20:00）' : '每 4 小时增量推送（有新通知立即发送）'

        await sendResendEmail(env, {
          to: email,
          subject: '【华师旧闻缓递】校内通知订阅已生效',
          text: `您已成功订阅华东师大·旧闻缓递（${siteUrl}）！\n推送方式：${freqLabel}\n已选通知源数量：${sources.length} 个\n${keywords.length ? `关键词过滤：${keywords.join('、')}\n` : ''}\n如需一键退订，请访问：${unsubUrl}`,
          html: `
            <div style="background:#f6f4ef;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c1917;">
              <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e5e4;border-radius:12px;padding:28px;">
                <div style="font-size:11px;letter-spacing:0.2em;color:#7a2c38;font-weight:600;">ECNU TIMES · 华师旧闻缓递</div>
                <h2 style="margin:8px 0 14px;font-size:20px;color:#1c1917;">订阅已生效</h2>
                <p style="font-size:14px;color:#57534e;line-height:1.6;margin:0 0 16px;">
                  您好！您的校内通知邮件订阅已保存成功：
                </p>
                <div style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:8px;padding:14px 16px;font-size:13px;line-height:1.8;color:#44403c;">
                  <div><strong>接收邮箱：</strong>${email}</div>
                  <div><strong>推送方式：</strong>${freqLabel}</div>
                  <div><strong>订阅来源：</strong>共 ${sources.length} 个院系/部门</div>
                  <div><strong>关键词过滤：</strong>${keywords.length ? keywords.join('、') : '无（接收所选来源全部新通知）'}</div>
                </div>
                <div style="margin-top:20px;font-size:12px;color:#78716c;line-height:1.6;">
                  <a href="${siteUrl}/?subscribe=1" style="color:#7a2c38;text-decoration:underline;">修改订阅偏好</a>
                  &nbsp;·&nbsp;
                  <a href="${unsubUrl}" style="color:#78716c;text-decoration:underline;">一键取消订阅</a>
                </div>
              </div>
            </div>
          `,
        })

        return jsonResponse({ ok: true })
      }

      // 3. 验证码方式退订 (POST /api/unsubscribe)
      if (path === '/api/unsubscribe' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}))
        const email = String(body.email || '').trim().toLowerCase()
        const code = String(body.code || '').trim()
        const token = String(body.token || '').trim()

        const [expStr, sig] = token.split('.')
        const expiresAt = Number(expStr)
        if (!expiresAt || !sig || Date.now() > expiresAt) {
          return jsonResponse({ ok: false, error: '验证码已过期，请重新获取' }, 400)
        }
        const expectedSig = await hmacSign(env.SECRET_KEY, `code:${email}:${code}:${expiresAt}`)
        if (sig !== expectedSig) {
          return jsonResponse({ ok: false, error: '验证码不正确' }, 400)
        }

        const index = await loadIndex(env)
        delete index[email]
        await saveIndex(env, index)
        return jsonResponse({ ok: true })
      }

      // 4. 邮件底部一键退订链接 (GET /api/unsubscribe?email=...&token=...)
      if (path === '/api/unsubscribe' && request.method === 'GET') {
        const email = String(url.searchParams.get('email') || '').trim().toLowerCase()
        const token = String(url.searchParams.get('token') || '').trim()
        if (!email || !token) {
          return htmlResponse('<h3>参数缺失，无法完成退订</h3>', 400)
        }
        const expected = await hmacSign(env.SECRET_KEY, `unsub:${email}`)
        if (token !== expected) {
          return htmlResponse('<h3>退订链接无效或签名校验失败</h3>', 403)
        }
        const index = await loadIndex(env)
        delete index[email]
        await saveIndex(env, index)

        return htmlResponse(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>已取消订阅 · 华师旧闻缓递</title>
</head>
<body style="background:#f6f4ef;margin:0;padding:48px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI', sans-serif;color:#1c1917;">
  <div style="max-width:440px;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:14px;padding:28px;text-align:center;">
    <div style="font-size:11px;letter-spacing:0.2em;color:#7a2c38;font-weight:600;">ECNU TIMES</div>
    <h2 style="margin:10px 0 12px;font-size:20px;">已成功取消订阅</h2>
    <p style="font-size:14px;color:#57534e;line-height:1.6;">邮箱 <strong>${email}</strong> 将不再收到华师旧闻缓递的邮件通知。</p>
    <a href="${siteUrl}" style="display:inline-block;margin-top:16px;padding:8px 18px;background:#7a2c38;color:#fff;border-radius:8px;text-decoration:none;font-size:13px;">返回旧闻缓递首页</a>
  </div>
</body>
</html>`)
      }

      // 5. 供 GitHub Actions 拉取全部订阅者列表 (GET /api/subscribers)
      if (path === '/api/subscribers' && request.method === 'GET') {
        const auth = request.headers.get('Authorization') || ''
        if (auth !== `Bearer ${env.SECRET_KEY}`) {
          return jsonResponse({ ok: false, error: 'Unauthorized' }, 401)
        }
        const index = await loadIndex(env)
        const subscribers = []
        for (const sub of Object.values(index)) {
          const unsubToken = await hmacSign(env.SECRET_KEY, `unsub:${sub.email}`)
          subscribers.push({
            ...sub,
            unsubUrl: `${url.origin}/api/unsubscribe?email=${encodeURIComponent(sub.email)}&token=${unsubToken}`,
          })
        }
        return jsonResponse({ ok: true, subscribers })
      }

      return jsonResponse({ ok: false, error: 'Not found' }, 404)
    } catch (e) {
      return jsonResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
    }
  },
}

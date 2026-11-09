/**
 * 前端与抓取脚本（scripts/fetch-notices.ts）共用的数据类型。
 * 注意：此文件会被 Node 以 type stripping 方式直接执行，只能写类型，不要使用 enum 等需要编译的语法。
 */

export type Category = 'general' | 'college' | 'science' | 'humanities'

/** 一个通知来源，对应 RSSHub 中的一条路由 */
export interface Source {
  /** 唯一标识，用于本地存储与 notices.json 关联 */
  id: string
  name: string
  /** RSSHub 路由，如 /ecnu/bksy */
  route: string
  homepage: string
  /** 相对 public/ 的图标路径 */
  logo: string
  category: Category
}

export interface Notice {
  /** 原文链接，同时作为唯一 ID */
  link: string
  sourceId: string
  title: string
  /** ISO 8601；源站未提供时为 null */
  date: string | null
  /** 去除 HTML 后的纯文本摘要 */
  summary: string
  /** 第一次被抓取到的时间，用于判断「新」通知 */
  firstSeenAt?: string
}

export interface SourceStatus {
  id: string
  ok: boolean
  count: number
  error?: string
}

/** public/notices.json 的结构 */
export interface NoticesFile {
  updatedAt: string
  sources: SourceStatus[]
  notices: Notice[]
}

/** 邮件推送频率：instant = 每 4 小时增量推送；daily = 每日 20:00 汇总日报 */
export type PushFrequency = 'instant' | 'daily'

/** 订阅者配置 */
export interface Subscriber {
  email: string
  sources: string[]
  frequency: PushFrequency
  keywords: string[]
  createdAt: string
  updatedAt: string
  unsubUrl?: string
}

